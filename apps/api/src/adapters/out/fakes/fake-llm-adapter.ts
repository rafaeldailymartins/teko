import { setTimeout as sleep } from 'node:timers/promises'
import {
  LlmError,
  LlmErrorKind,
  type LlmEvent,
  type LlmModel,
  type LlmRequest,
} from '#app/ports/llm-port.ts'

/**
 * LLM fake e determinístico (`LLM_PROVIDER=fake`, só development e ci): responde citando as fontes
 * do prompt (`<source id="S1" …>`) e obedece a marcadores de falha no texto da pergunta, para
 * testes, e2e e evals na stack de CI:
 *
 * - `[[fault:429]]`, `[[fault:5xx]]`: falha antes do primeiro token (o router tenta o próximo);
 * - `[[fault:timeout]]`: não responde até o sinal abortar;
 * - `[[fault:slow]]`: um pedaço a cada 50 ms, por até 60 s (desconexão e teto do stream);
 * - `[[fault:mid-stream]]`: falha depois do primeiro token (sem fallback);
 * - `[[fault:bad-citation]]`: cita `[S99]`, que não existe;
 * - `[[fault:xss]]`: devolve HTML cru e imagem, que a saída precisa remover;
 * - `[[fault:insufficient]]`: devolve a sentinela `INSUFICIENTE`.
 */
export const FAKE_LLM_MODEL = 'fake-llm-1'

const SOURCE_ID = /<source id="(S\d+)"/g

function sourceIds(prompt: string): string[] {
  return [...prompt.matchAll(SOURCE_ID)].map((match) => match[1] ?? '')
}

function answerFor(prompt: string): string {
  if (prompt.includes('[[fault:insufficient]]')) {
    return 'INSUFICIENTE'
  }
  if (prompt.includes('[[fault:bad-citation]]')) {
    return 'Segundo a fonte [S99], a resposta é esta.'
  }
  if (prompt.includes('[[fault:xss]]')) {
    return 'Veja <script>alert(1)</script> e ![x](https://evil.example/x.png) conforme [S1].'
  }
  const ids = sourceIds(prompt)
  if (ids.length === 0) {
    return 'INSUFICIENTE'
  }
  const cited = ids.slice(0, 2).map((id) => `[${id}]`)
  return `Conforme as fontes ${cited.join(' e ')}, a regra vigente na data é a citada.`
}

function abortable(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function wordsOf(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}

export function createFakeLlmAdapter(
  options: { readonly model?: string; readonly zeroDataRetention?: boolean } = {},
): LlmModel {
  return {
    provider: 'fake',
    model: options.model ?? FAKE_LLM_MODEL,
    zeroDataRetention: options.zeroDataRetention ?? true,
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const { prompt, signal } = request
      if (prompt.includes('[[fault:429]]')) {
        throw new LlmError(LlmErrorKind.RateLimited, 'fake 429', 1000)
      }
      if (prompt.includes('[[fault:5xx]]')) {
        throw new LlmError(LlmErrorKind.Unavailable, 'fake 503')
      }
      if (prompt.includes('[[fault:timeout]]')) {
        await abortable(signal)
      }
      const answer = answerFor(prompt)
      const slow = prompt.includes('[[fault:slow]]')
      const words = slow ? Array.from({ length: 1200 }, () => 'devagar ') : wordsOf(answer)
      let first = true
      for (const word of words) {
        if (signal.aborted) {
          throw signal.reason
        }
        if (slow) {
          await sleep(50, undefined, { signal }).catch(() => {
            throw signal.reason
          })
        }
        yield { type: 'text', text: word }
        if (first && prompt.includes('[[fault:mid-stream]]')) {
          throw new LlmError(LlmErrorKind.Unavailable, 'fake mid-stream failure')
        }
        first = false
      }
      yield {
        type: 'finish',
        usage: {
          inputTokens: Math.ceil((request.system.length + prompt.length) / 4),
          outputTokens: words.length,
        },
      }
    },
  }
}
