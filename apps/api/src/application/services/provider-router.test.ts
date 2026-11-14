import { describe, expect, it } from 'vitest'
import { ApplicationError } from '../errors.ts'
import {
  LlmError,
  LlmErrorKind,
  type LlmEvent,
  type LlmModel,
  type LlmRequest,
} from '../ports/llm-port.ts'
import { BREAKER_OPEN_MS, createProviderRouter, type RoutedEvent } from './provider-router.ts'

type Behavior = 'ok' | '429' | '429-no-header' | '5xx' | 'mid-stream' | 'abort' | 'boom'

function model(
  name: string,
  behaviors: Behavior[],
  options: { readonly zdr?: boolean } = {},
): LlmModel & { calls: number } {
  const result = {
    provider: name.startsWith('groq') ? ('groq' as const) : ('gemini' as const),
    model: name,
    zeroDataRetention: options.zdr ?? false,
    calls: 0,
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const behavior = behaviors[result.calls] ?? 'ok'
      result.calls += 1
      if (behavior === '429') {
        throw new LlmError(LlmErrorKind.RateLimited, '429', 30_000)
      }
      if (behavior === '429-no-header') {
        throw new LlmError(LlmErrorKind.RateLimited, '429')
      }
      if (behavior === '5xx') {
        throw new LlmError(LlmErrorKind.Unavailable, '503')
      }
      if (behavior === 'abort') {
        throw request.signal.reason
      }
      if (behavior === 'boom') {
        throw new TypeError('bug')
      }
      yield { type: 'text', text: `${name}:a ` }
      if (behavior === 'mid-stream') {
        throw new LlmError(LlmErrorKind.Unavailable, 'caiu')
      }
      yield { type: 'text', text: 'b' }
      yield { type: 'finish', usage: { inputTokens: 10, outputTokens: 2 } }
    },
  }
  return result
}

const REQUEST: LlmRequest = {
  system: 's',
  prompt: 'p',
  temperature: 0.1,
  maxOutputTokens: 100,
  signal: new AbortController().signal,
}
const ANY = { zeroDataRetentionOnly: false }

async function collect(stream: AsyncIterable<RoutedEvent>): Promise<RoutedEvent[]> {
  const events: RoutedEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function clockAt(iso: string) {
  let now = Date.parse(iso)
  return {
    clock: { now: () => new Date(now) },
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('createProviderRouter', () => {
  it('usa o primeiro modelo quando ele responde', async () => {
    const primary = model('gemini-a', ['ok'])
    const router = createProviderRouter({
      models: [primary, model('groq-c', [])],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    const events = await collect(router.stream(REQUEST, ANY))
    expect(events).toEqual([
      { type: 'start', provider: 'gemini', model: 'gemini-a', fallbackFrom: null },
      { type: 'text', text: 'gemini-a:a ' },
      { type: 'text', text: 'b' },
      { type: 'finish', usage: { inputTokens: 10, outputTokens: 2 } },
    ])
  })

  it('cai para o próximo antes do primeiro token e informa de onde caiu', async () => {
    const router = createProviderRouter({
      models: [model('gemini-a', ['5xx']), model('gemini-b', ['429']), model('groq-c', ['ok'])],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    const [start] = await collect(router.stream(REQUEST, ANY))
    expect(start).toEqual({
      type: 'start',
      provider: 'groq',
      model: 'groq-c',
      fallbackFrom: 'gemini-a',
    })
  })

  it('429 abre o breaker até o retry-after', async () => {
    const { clock, advance } = clockAt('2026-11-10T15:00:00Z')
    const primary = model('gemini-a', ['429', 'ok'])
    const router = createProviderRouter({ models: [primary, model('groq-c', [])], clock })
    await collect(router.stream(REQUEST, ANY))
    expect(router.available(ANY)).toEqual(['groq-c'])
    advance(29_999)
    expect(router.available(ANY)).toEqual(['groq-c'])
    advance(1)
    expect(router.available(ANY)).toEqual(['gemini-a', 'groq-c'])
  })

  it('429 sem retry-after abre até a meia-noite do Pacífico', async () => {
    const { clock, advance } = clockAt('2026-11-10T15:00:00Z')
    const router = createProviderRouter({
      models: [model('gemini-a', ['429-no-header']), model('groq-c', [])],
      clock,
    })
    await collect(router.stream(REQUEST, ANY))
    advance(Date.parse('2026-11-11T08:00:00Z') - Date.parse('2026-11-10T15:00:00Z') - 1)
    expect(router.available(ANY)).toEqual(['groq-c'])
    advance(1)
    expect(router.available(ANY)).toEqual(['gemini-a', 'groq-c'])
  })

  it('3 falhas seguidas abrem o breaker por 60 s; um sucesso zera a contagem', async () => {
    const { clock, advance } = clockAt('2026-11-10T15:00:00Z')
    const primary = model('gemini-a', ['5xx', '5xx', 'ok', '5xx', '5xx', '5xx'])
    const router = createProviderRouter({ models: [primary, model('groq-c', [])], clock })
    for (let call = 0; call < 5; call += 1) {
      await collect(router.stream(REQUEST, ANY))
      expect(router.available(ANY)).toContain('gemini-a')
    }
    await collect(router.stream(REQUEST, ANY))
    expect(router.available(ANY)).toEqual(['groq-c'])
    advance(BREAKER_OPEN_MS)
    expect(router.available(ANY)).toContain('gemini-a')
  })

  it('com ZDR obrigatório, só o Groq entra', async () => {
    const gemini = model('gemini-a', [])
    const router = createProviderRouter({
      models: [gemini, model('groq-c', ['ok'], { zdr: true })],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    const [start] = await collect(router.stream(REQUEST, { zeroDataRetentionOnly: true }))
    expect(start).toMatchObject({ model: 'groq-c', fallbackFrom: null })
    expect(gemini.calls).toBe(0)
    expect(router.hasZeroRetentionModel()).toBe(true)
    expect(
      createProviderRouter({
        models: [gemini],
        clock: clockAt('2026-11-10T15:00:00Z').clock,
      }).hasZeroRetentionModel(),
    ).toBe(false)
  })

  it('falha depois do primeiro token não cai para outro modelo', async () => {
    const backup = model('groq-c', [])
    const router = createProviderRouter({
      models: [model('gemini-a', ['mid-stream']), backup],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    const events: RoutedEvent[] = []
    await expect(async () => {
      for await (const event of router.stream(REQUEST, ANY)) {
        events.push(event)
      }
    }).rejects.toMatchObject({ problem: { code: 'upstream_unavailable' } })
    expect(events.map((event) => event.type)).toEqual(['start', 'text'])
    expect(backup.calls).toBe(0)
  })

  it('todos fora do ar → upstream_unavailable', async () => {
    const router = createProviderRouter({
      models: [model('gemini-a', ['5xx']), model('groq-c', ['5xx'])],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    await expect(collect(router.stream(REQUEST, ANY))).rejects.toBeInstanceOf(ApplicationError)
  })

  it('cancelamento e bugs não contam como falha do modelo e passam adiante', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cliente saiu'))
    const primary = model('gemini-a', ['abort', 'boom'])
    const router = createProviderRouter({
      models: [primary, model('groq-c', [])],
      clock: clockAt('2026-11-10T15:00:00Z').clock,
    })
    await expect(
      collect(router.stream({ ...REQUEST, signal: controller.signal }, ANY)),
    ).rejects.toThrow('cliente saiu')
    await expect(collect(router.stream(REQUEST, ANY))).rejects.toBeInstanceOf(TypeError)
    expect(router.available(ANY)).toContain('gemini-a')
  })
})
