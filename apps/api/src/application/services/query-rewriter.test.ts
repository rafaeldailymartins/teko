import { describe, expect, it } from 'vitest'
import { LlmError, LlmErrorKind, type LlmModel, type LlmRequest } from '../ports/llm-port.ts'
import { recordingLlmTracing } from '../ports/testing/recording-llm-tracing.ts'
import {
  REWRITE_MAX_OUTPUT_TOKENS,
  REWRITE_REASONING,
  REWRITE_TEMPERATURE,
} from '../prompts/rewrite.ts'
import { createProviderRouter } from './provider-router.ts'
import { createQueryRewriter } from './query-rewriter.ts'
import { createQueryTracer } from './trace-sampler.ts'

const clock = { now: () => new Date('2026-11-14T12:00:00Z') }

type Behavior = { readonly text: string } | 'fail' | 'hang' | 'boom'

function model(
  name: string,
  behavior: Behavior,
  zeroDataRetention = false,
): LlmModel & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = []
  return {
    provider: 'gemini',
    model: name,
    zeroDataRetention,
    requests,
    async *stream(request) {
      requests.push(request)
      if (behavior === 'fail') {
        throw new LlmError(LlmErrorKind.Unavailable, '503')
      }
      if (behavior === 'boom') {
        throw new TypeError('bug')
      }
      if (behavior === 'hang') {
        await new Promise((_resolve, reject) => {
          if (request.signal.aborted) {
            reject(request.signal.reason)
            return
          }
          request.signal.addEventListener('abort', () => reject(request.signal.reason))
        })
      }
      if (typeof behavior === 'object') {
        for (const word of behavior.text.split(/(?<= )/)) {
          yield { type: 'text', text: word }
        }
      }
      yield { type: 'finish', usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
}

function rewriterWith(models: readonly LlmModel[], timeoutMs = 1000) {
  return createQueryRewriter({ router: createProviderRouter({ models, clock }), timeoutMs })
}

describe('createQueryRewriter', () => {
  it('pede uma consulta curta e determinística e devolve a saída limpa', async () => {
    const gemini = model('gemini', { text: '"alíquota interna do ICMS nas operações internas"\n' })
    const rewritten = await rewriterWith([gemini])('alíquota geral nas vendas dentro de Goiás?', {
      zeroDataRetentionOnly: false,
    })
    expect(rewritten).toBe('alíquota interna do ICMS nas operações internas')
    const [request] = gemini.requests
    expect(request?.temperature).toBe(REWRITE_TEMPERATURE)
    expect(request?.maxOutputTokens).toBe(REWRITE_MAX_OUTPUT_TOKENS)
    expect(request?.reasoning).toBe(REWRITE_REASONING)
    expect(request?.prompt).toBe('<pergunta>alíquota geral nas vendas dentro de Goiás?</pergunta>')
  })

  it('usuário do EEE/UK/CH: só modelos com ZDR', async () => {
    const gemini = model('gemini', { text: 'não deveria' })
    const groq = model('groq', { text: 'consulta pelo groq' }, true)
    await expect(
      rewriterWith([gemini, groq])('pergunta', { zeroDataRetentionOnly: true }),
    ).resolves.toBe('consulta pelo groq')
    expect(gemini.requests).toHaveLength(0)
  })

  it('cadeia fora do ar, teto ou saída vazia: null (a busca segue com a pergunta)', async () => {
    await expect(
      rewriterWith([model('gemini', 'fail')])('pergunta', { zeroDataRetentionOnly: false }),
    ).resolves.toBeNull()
    await expect(
      rewriterWith([model('gemini', 'hang')], 5)('pergunta', { zeroDataRetentionOnly: false }),
    ).resolves.toBeNull()
    await expect(
      rewriterWith([model('gemini', { text: '  \n ' })])('pergunta', {
        zeroDataRetentionOnly: false,
      }),
    ).resolves.toBeNull()
  })

  it('cancelamento do cliente e erro inesperado propagam', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cliente saiu'))
    await expect(
      rewriterWith([model('gemini', 'hang')])('pergunta', {
        zeroDataRetentionOnly: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cliente saiu')
    await expect(
      rewriterWith([model('gemini', 'boom')])('pergunta', { zeroDataRetentionOnly: false }),
    ).rejects.toThrow('bug')
  })
})

describe('generations da reescrita no trace (Langfuse)', () => {
  async function traced() {
    const port = recordingLlmTracing()
    const trace = await createQueryTracer({
      port,
      sampler: { shouldSample: async () => true },
    }).start({
      questionId: 'q1',
      userId: 'u1',
      question: 'x',
      locale: 'pt-BR',
      families: [],
      referenceDate: '2026-11-01',
      referenceSource: 'explicit',
      corpusVersion: 1,
      promptVersion: 'p',
      cached: false,
      startedAtMs: 0,
    })
    return { port, trace }
  }

  it('uma generation rewrite por provedor tentado, com o uso e a saída', async () => {
    const { port, trace } = await traced()
    const rewriter = createQueryRewriter({
      router: createProviderRouter({
        models: [model('gemini-a', 'fail'), model('gemini-b', { text: 'prazo do ICMS' })],
        clock,
      }),
      timeoutMs: 1000,
      nowMs: () => 42,
    })
    expect(await rewriter('qual o prazo?', { zeroDataRetentionOnly: false, trace })).toBe(
      'prazo do ICMS',
    )
    const generations = port.queries[0]?.generations ?? []
    expect(generations.map((item) => [item.start.name, item.start.model, item.end?.error])).toEqual(
      [
        ['rewrite', 'gemini-a', 'unavailable'],
        ['rewrite', 'gemini-b', null],
      ],
    )
    expect(generations[1]?.end).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 5 },
      output: 'prazo do ICMS',
      firstTokenAtMs: 42,
      endedAtMs: 42,
    })
    expect(trace.units()).toBe(4)
  })

  it('teto estourado: a generation aberta fecha com aborted e a busca segue sem reescrita', async () => {
    const { port, trace } = await traced()
    const hanging: LlmModel = {
      provider: 'groq',
      model: 'groq-a',
      zeroDataRetention: true,
      async *stream(request) {
        yield { type: 'text', text: 'prazo ' }
        await new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason))
        })
      },
    }
    const rewriter = createQueryRewriter({
      router: createProviderRouter({ models: [hanging], clock }),
      timeoutMs: 10,
    })
    expect(await rewriter('x', { zeroDataRetentionOnly: false, trace })).toBeNull()
    expect(port.queries[0]?.generations.map((item) => item.end?.error)).toEqual(['aborted'])
  })
})
