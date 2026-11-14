import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { tokenize, type WordDiffSegment, wordDiff } from './word-diff.ts'

function rebuild(segments: readonly WordDiffSegment[], side: 'before' | 'after'): string {
  const skip = side === 'before' ? 'insert' : 'delete'
  return segments
    .filter((segment) => segment.op !== skip)
    .map((segment) => segment.text)
    .join('')
}

/** Maior subsequência comum por programação dinâmica (referência para entradas pequenas). */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0)
  for (const token of a) {
    let diagonal = 0
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0
      row[j] = token === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0)
      diagonal = above
    }
  }
  return row[b.length] ?? 0
}

describe('tokenize', () => {
  it('gruda o espaço na palavra seguinte e preserva o espaço final', () => {
    expect(tokenize('a  b c ')).toEqual(['a', '  b', ' c', ' '])
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual(['   '])
    expect(tokenize('\ta\nb')).toEqual(['\ta', '\nb'])
  })

  test.prop([fc.string({ unit: fc.constantFrom('a', 'b', ' ', '\n', '\t'), maxLength: 60 })])(
    'concatenar os tokens devolve o texto; só o último token pode ser só espaço',
    (text) => {
      const tokens = tokenize(text)
      expect(tokens.join('')).toBe(text)
      for (const token of tokens.slice(0, -1)) {
        expect(token.trim()).not.toBe('')
      }
    },
  )
})

describe('wordDiff', () => {
  it('marca só a palavra trocada', () => {
    expect(wordDiff('I - 17% na operação interna', 'I - 19% na operação interna')).toEqual([
      { op: 'equal', text: 'I -' },
      { op: 'delete', text: ' 17%' },
      { op: 'insert', text: ' 19%' },
      { op: 'equal', text: ' na operação interna' },
    ])
  })

  it('textos iguais viram um segmento só; vazios, nenhum', () => {
    expect(wordDiff('igual', 'igual')).toEqual([{ op: 'equal', text: 'igual' }])
    expect(wordDiff('', '')).toEqual([])
  })

  it('acréscimo e supressão no meio', () => {
    expect(wordDiff('a b c', 'a x b c')).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'insert', text: ' x' },
      { op: 'equal', text: ' b c' },
    ])
    expect(wordDiff('a x b c', 'a b c')).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: ' x' },
      { op: 'equal', text: ' b c' },
    ])
  })

  it('acima do teto de edições, apaga e insere o miolo inteiro', () => {
    expect(wordDiff('p a b q', 'p c d q', 1)).toEqual([
      { op: 'equal', text: 'p' },
      { op: 'delete', text: ' a b' },
      { op: 'insert', text: ' c d' },
      { op: 'equal', text: ' q' },
    ])
  })

  const words = fc.array(fc.constantFrom('a', 'b', 'c', 'art.', '19%', ' '), { maxLength: 30 })

  test.prop([words, words])('reconstrói os dois textos', (left, right) => {
    const before = left.join(' ')
    const after = right.join(' ')
    const segments = wordDiff(before, after)
    expect(rebuild(segments, 'before')).toBe(before)
    expect(rebuild(segments, 'after')).toBe(after)
  })

  test.prop([words, words])('edita o mínimo de palavras (n + m − 2·LCS)', (left, right) => {
    const before = left.join(' ')
    const after = right.join(' ')
    const edited = wordDiff(before, after)
      .filter((segment) => segment.op !== 'equal')
      .reduce((total, segment) => total + tokenize(segment.text).length, 0)
    const a = tokenize(before)
    const b = tokenize(after)
    expect(edited).toBe(a.length + b.length - 2 * lcsLength(a, b))
  })

  it('com o teto justo para a distância, ainda acha o diff mínimo', () => {
    expect(wordDiff('a b c', 'a x c', 2)).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: ' b' },
      { op: 'insert', text: ' x' },
      { op: 'equal', text: ' c' },
    ])
  })

  test.prop([words, words])('nunca tem dois segmentos seguidos com a mesma operação', (l, r) => {
    const segments = wordDiff(l.join(' '), r.join(' '))
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]?.op).not.toBe(segments[index - 1]?.op)
    }
  })
})
