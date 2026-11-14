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

describe('tokenize', () => {
  it('gruda o espaço na palavra seguinte e preserva o espaço final', () => {
    expect(tokenize('a  b c ')).toEqual(['a', '  b', ' c', ' '])
    expect(tokenize('')).toEqual([])
  })
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

  test.prop([words, words])('nunca tem dois segmentos seguidos com a mesma operação', (l, r) => {
    const segments = wordDiff(l.join(' '), r.join(' '))
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]?.op).not.toBe(segments[index - 1]?.op)
    }
  })
})
