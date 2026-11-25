import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmEvent, LlmModel, LlmRequest } from '#app/ports/llm-port.ts'
import type { LlmChainConfig } from './chain-models.ts'

const real = vi.hoisted(() => ({ createLlmChain: vi.fn() }))

vi.mock('./ai-sdk-llm.ts', () => real)

const { createLazyLlmChain } = await import('./lazy-llm-chain.ts')

const CONFIG: LlmChainConfig = {
  geminiApiKey: 'gemini-key',
  groqApiKey: 'groq-key',
  geminiModels: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'],
  groqModel: 'openai/gpt-oss-120b',
}

function fakeModel(model: string): LlmModel {
  return {
    provider: model.startsWith('gemini') ? 'gemini' : 'groq',
    model,
    zeroDataRetention: !model.startsWith('gemini'),
    async *stream(): AsyncIterable<LlmEvent> {
      yield { type: 'text', text: model }
      yield { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
}

const REQUEST: LlmRequest = {
  system: 's',
  prompt: 'p',
  temperature: 0,
  maxOutputTokens: 10,
  signal: new AbortController().signal,
}

async function collect(events: AsyncIterable<LlmEvent> | readonly LlmEvent[]): Promise<LlmEvent[]> {
  const out: LlmEvent[] = []
  for await (const event of events) {
    out.push(event)
  }
  return out
}

beforeEach(() => {
  real.createLlmChain.mockReset()
  real.createLlmChain.mockImplementation((config: LlmChainConfig) =>
    [...config.geminiModels, config.groqModel].map(fakeModel),
  )
})

describe('createLazyLlmChain', () => {
  it('expõe a cadeia do plano sem carregar o AI SDK', () => {
    const chain = createLazyLlmChain(CONFIG)

    expect(
      chain.map(({ provider, model, zeroDataRetention }) => [provider, model, zeroDataRetention]),
    ).toEqual([
      ['gemini', 'gemini-3.5-flash-lite', false],
      ['gemini', 'gemini-3.6-flash', false],
      ['groq', 'openai/gpt-oss-120b', true],
    ])
    expect(real.createLlmChain).not.toHaveBeenCalled()
  })

  it('carrega a cadeia real uma vez e delega ao modelo de mesma posição', async () => {
    const chain = createLazyLlmChain(CONFIG)

    const [groq, primary] = await Promise.all([
      collect(chain[2]?.stream(REQUEST) ?? []),
      collect(chain[0]?.stream(REQUEST) ?? []),
    ])

    expect(groq[0]).toEqual({ type: 'text', text: 'openai/gpt-oss-120b' })
    expect(primary[0]).toEqual({ type: 'text', text: 'gemini-3.5-flash-lite' })
    expect(real.createLlmChain).toHaveBeenCalledTimes(1)
    expect(real.createLlmChain).toHaveBeenCalledWith(CONFIG)
  })

  it('o preload de qualquer modelo carrega a cadeia inteira uma vez', async () => {
    const chain = createLazyLlmChain(CONFIG)

    await Promise.all(chain.map((model) => model.preload()))
    await collect(chain[1]?.stream(REQUEST) ?? [])

    expect(real.createLlmChain).toHaveBeenCalledTimes(1)
  })

  it('o erro do modelo real chega a quem consome o stream', async () => {
    real.createLlmChain.mockImplementation(() => [
      {
        ...fakeModel('gemini-3.5-flash-lite'),
        // biome-ignore lint/correctness/useYield: o modelo falha antes do primeiro evento.
        async *stream(): AsyncIterable<LlmEvent> {
          throw new Error('provider unavailable')
        },
      },
    ])
    const [primary] = createLazyLlmChain(CONFIG)

    await expect(collect(primary?.stream(REQUEST) ?? [])).rejects.toThrow('provider unavailable')
  })
})
