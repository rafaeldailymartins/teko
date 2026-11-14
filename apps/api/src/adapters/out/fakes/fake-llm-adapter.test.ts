import { describe, expect, it } from 'vitest'
import { LlmError, type LlmEvent } from '#app/ports/llm-port.ts'
import { createFakeLlmAdapter, FAKE_LLM_MODEL } from './fake-llm-adapter.ts'

const SOURCES = '<source id="S1" label="a">x</source>\n<source id="S2" label="b">y</source>'

async function run(prompt: string, signal = new AbortController().signal): Promise<LlmEvent[]> {
  const events: LlmEvent[] = []
  for await (const event of createFakeLlmAdapter().stream({
    system: 's',
    prompt,
    temperature: 0.1,
    maxOutputTokens: 100,
    signal,
  })) {
    events.push(event)
  }
  return events
}

function text(events: readonly LlmEvent[]): string {
  return events.map((event) => (event.type === 'text' ? event.text : '')).join('')
}

describe('createFakeLlmAdapter', () => {
  it('identifica-se como fake, com ZDR', () => {
    const adapter = createFakeLlmAdapter()
    expect([adapter.provider, adapter.model, adapter.zeroDataRetention]).toEqual([
      'fake',
      FAKE_LLM_MODEL,
      true,
    ])
    expect(createFakeLlmAdapter({ model: 'm', zeroDataRetention: false }).zeroDataRetention).toBe(
      false,
    )
  })

  it('cita as duas primeiras fontes e informa o uso', async () => {
    const events = await run(SOURCES)
    expect(text(events)).toBe('Conforme as fontes [S1] e [S2], a regra vigente na data é a citada.')
    expect(events.at(-1)).toMatchObject({ type: 'finish', usage: { outputTokens: 14 } })
  })

  it.each([
    ['sem fontes', '', 'INSUFICIENTE'],
    ['[[fault:insufficient]]', SOURCES, 'INSUFICIENTE'],
    ['[[fault:bad-citation]]', SOURCES, 'Segundo a fonte [S99], a resposta é esta.'],
  ])('%s', async (marker, sources, expected) => {
    expect(text(await run(`${sources}\n${marker}`))).toBe(expected)
  })

  it('reescrita da pergunta: devolve a própria pergunta', async () => {
    expect(text(await run('<pergunta>alíquota interna do ICMS</pergunta>'))).toBe(
      'alíquota interna do ICMS',
    )
  })

  it('[[fault:xss]] devolve HTML e imagem', async () => {
    expect(text(await run(`${SOURCES} [[fault:xss]]`))).toContain('<script>')
  })

  it.each([
    ['[[fault:429]]', 'rate_limited'],
    ['[[fault:5xx]]', 'unavailable'],
  ])('%s falha antes do primeiro token', async (marker, kind) => {
    await expect(run(`${SOURCES} ${marker}`)).rejects.toMatchObject({ kind })
  })

  it('[[fault:mid-stream]] falha depois do primeiro token', async () => {
    const events: LlmEvent[] = []
    await expect(async () => {
      for await (const event of createFakeLlmAdapter().stream({
        system: 's',
        prompt: `${SOURCES} [[fault:mid-stream]]`,
        temperature: 0,
        maxOutputTokens: 1,
        signal: new AbortController().signal,
      })) {
        events.push(event)
      }
    }).rejects.toBeInstanceOf(LlmError)
    expect(events).toHaveLength(1)
  })

  it('[[fault:timeout]] e [[fault:slow]] param no cancelamento', async () => {
    const controller = new AbortController()
    const reason = new Error('saiu')
    const pending = run(`${SOURCES} [[fault:timeout]]`, controller.signal)
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)

    const aborted = new AbortController()
    aborted.abort(reason)
    await expect(run(`${SOURCES} [[fault:timeout]]`, aborted.signal)).rejects.toBe(reason)

    const slow = new AbortController()
    setTimeout(() => slow.abort(reason), 120)
    await expect(run(`${SOURCES} [[fault:slow]]`, slow.signal)).rejects.toBe(reason)
  })

  it('sinal abortado entre pedaços interrompe', async () => {
    const controller = new AbortController()
    const events: LlmEvent[] = []
    await expect(async () => {
      for await (const event of createFakeLlmAdapter().stream({
        system: 's',
        prompt: SOURCES,
        temperature: 0,
        maxOutputTokens: 1,
        signal: controller.signal,
      })) {
        events.push(event)
        controller.abort(new Error('parou'))
      }
    }).rejects.toThrow('parou')
    expect(events).toHaveLength(1)
  })
})
