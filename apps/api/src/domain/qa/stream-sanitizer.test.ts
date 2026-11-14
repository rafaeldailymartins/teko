import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { renderAnswerMarkdown } from './answer-output.ts'
import { createStreamSanitizer, MAX_HOLD, pendingMarkupStart } from './stream-sanitizer.ts'

const CANARY = 'TEKO-CANARY-0123abcd'

function run(chunks: readonly string[]): { out: string; leaked: boolean } {
  const sanitizer = createStreamSanitizer(CANARY)
  let out = ''
  for (const chunk of chunks) {
    out += sanitizer.push(chunk)
  }
  out += sanitizer.flush()
  return { out, leaked: sanitizer.leaked }
}

describe('pendingMarkupStart', () => {
  it('retém tag, link, imagem e citação abertos', () => {
    expect(pendingMarkupStart('abc <scr')).toBe(4)
    expect(pendingMarkupStart('ver [S')).toBe(4)
    expect(pendingMarkupStart('ver [S1]')).toBe(4)
    expect(pendingMarkupStart('ver [S1] e')).toBe(10)
    expect(pendingMarkupStart('![x](http')).toBe(0)
    expect(pendingMarkupStart('fim!')).toBe(3)
    expect(pendingMarkupStart('ok! sim')).toBe(7)
    expect(pendingMarkupStart('[a](b) <i> pronto')).toBe(17)
    expect(pendingMarkupStart('x <a<b>>')).toBe(2)
  })

  it('só olha a janela final de MAX_HOLD caracteres', () => {
    const text = `<${'x'.repeat(MAX_HOLD + 10)}`
    expect(pendingMarkupStart(text)).toBe(text.length)
  })
})

describe('createStreamSanitizer', () => {
  it('uma tag partida entre pedaços não vaza', () => {
    expect(run(['Veja <scr', 'ipt>alert(1)</sc', 'ript> fim [S', '1].']).out).toBe(
      'Veja alert(1) fim [S1](cite:S1).',
    )
  })

  it('uma imagem partida entre pedaços some', () => {
    expect(run(['a ![x', '](https://evil', '.example/x.png) b']).out).toBe('a  b')
  })

  it('o canário interrompe a saída', () => {
    const result = run(['Regras: TEKO-CAN', 'ARY-0123abcd e mais', ' texto'])
    expect(result.leaked).toBe(true)
    expect(result.out).not.toContain('CANARY')
  })

  test.prop([
    fc.array(fc.constantFrom('a ', '<b>', '<', '>', '[S1]', '[', ']', '(', ')', '!', 'x'), {
      maxLength: 40,
    }),
    fc.integer({ min: 1, max: 7 }),
  ])('qualquer partição sai igual ao saneamento do texto inteiro, sem tags', (pieces, size) => {
    const text = pieces.join('')
    const chunks: string[] = []
    for (let index = 0; index < text.length; index += size) {
      chunks.push(text.slice(index, index + size))
    }
    const { out } = run(chunks)
    expect(out).not.toMatch(/<\/?[A-Za-z!][^<>]*>/)
    expect(out).not.toMatch(/!\[[^\]\n]*\]\([^)\n]*\)/)
    expect(out).toBe(renderAnswerMarkdown(text))
  })
})
