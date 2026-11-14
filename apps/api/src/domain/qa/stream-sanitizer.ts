import { renderAnswerMarkdown } from './answer-output.ts'

/**
 * Saneamento incremental dos `text-delta` do stream. Um pedaço do modelo pode terminar no meio de
 * uma tag (`<scr`), de uma imagem (`![x](htt`) ou de um marcador de citação (`[S`): o trecho a
 * partir da marcação incompleta mais antiga fica retido até fechar (ou até `MAX_HOLD` caracteres,
 * quando sai como texto). O que sai passa pelo mesmo saneamento da resposta gravada e já leva as
 * citações como links `cite:`.
 *
 * O fim do buffer também fica retido no tamanho do canário: se o canário do system prompt aparecer,
 * nada mais sai, e `leaked` fica verdadeiro.
 */
export const MAX_HOLD = 300

export interface StreamSanitizer {
  /** Texto seguro para enviar agora (pode ser vazio). */
  push(delta: string): string
  /** Resto retido, saneado (no fim do stream). */
  flush(): string
  /** O canário apareceu na saída. */
  readonly leaked: boolean
}

/** O colchete em `index` ainda pode virar link ou imagem com o que vier depois. */
function bracketOpen(text: string, index: number): boolean {
  const close = text.indexOf(']', index)
  if (close === -1 || close === text.length - 1) {
    return true
  }
  return text[close + 1] === '(' && !text.includes(')', close)
}

/** A tag em `index` ainda não fechou, ou tem outra `<` antes do `>` (`<a<b>>`). */
function tagOpen(text: string, index: number): boolean {
  const close = text.indexOf('>', index)
  return close === -1 || text.slice(index + 1, close).includes('<')
}

/** Índice da marcação incompleta mais antiga na janela final, ou o tamanho do texto. */
export function pendingMarkupStart(text: string): number {
  for (let index = Math.max(0, text.length - MAX_HOLD); index < text.length; index += 1) {
    const char = text[index]
    if (char === '<' && tagOpen(text, index)) {
      return index
    }
    if (char === '[' && bracketOpen(text, index)) {
      return index
    }
    if (
      char === '!' &&
      (index === text.length - 1 || (text[index + 1] === '[' && bracketOpen(text, index + 1)))
    ) {
      return index
    }
  }
  return text.length
}

const render = renderAnswerMarkdown

export function createStreamSanitizer(canary: string): StreamSanitizer {
  let buffer = ''
  let leaked = false
  return {
    get leaked() {
      return leaked
    },
    push(delta) {
      if (leaked) {
        return ''
      }
      buffer += delta
      if (buffer.includes(canary)) {
        leaked = true
        buffer = ''
        return ''
      }
      // Recuar pelo tamanho do canário pode cair no meio de uma tag completa: o corte final é a
      // marcação incompleta mais antiga do prefixo.
      const target = Math.min(pendingMarkupStart(buffer), buffer.length - (canary.length - 1))
      const cut = target <= 0 ? 0 : pendingMarkupStart(buffer.slice(0, target))
      if (cut <= 0) {
        return ''
      }
      const out = buffer.slice(0, cut)
      buffer = buffer.slice(cut)
      return render(out)
    },
    flush() {
      const out = leaked ? '' : buffer
      buffer = ''
      return render(out)
    },
  }
}
