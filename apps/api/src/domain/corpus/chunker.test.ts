import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { chunkText, continuationPrefix, DEFAULT_MAX_CHUNK_CHARS, embeddingText } from './chunker.ts'
import { normalizeForHash } from './text-normalization.ts'

const LABEL = 'RCTE, art. 76, § 6º'

/** O texto normalizado como o chunker o vê: parágrafos normalizados, separados por linha em branco. */
function normalizedParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map(normalizeForHash)
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n')
}

describe('chunkText', () => {
  it('uma redação curta vira um chunk, sem prefixo, com espaços colapsados', () => {
    expect(chunkText('  § 6º   Revogado.\n', LABEL)).toEqual([
      { ordinal: 0, content: '§ 6º Revogado.', body: '§ 6º Revogado.' },
    ])
    expect(DEFAULT_MAX_CHUNK_CHARS).toBe(4800)
  })

  it('o excedente vira chunks seguintes com o rótulo de continuação', () => {
    const paragraph = 'Lorem ipsum dolor sit amet. '.repeat(10).trim()
    const text = Array.from({ length: 6 }, () => paragraph).join('\n\n')
    const pieces = chunkText(text, LABEL, 600)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.map((piece) => piece.ordinal)).toEqual(pieces.map((_, index) => index))
    expect(pieces[0]?.content.startsWith(continuationPrefix(LABEL))).toBe(false)
    for (const piece of pieces.slice(1)) {
      expect(piece.content.startsWith(continuationPrefix(LABEL))).toBe(true)
    }
    for (const piece of pieces) {
      expect(piece.body.length).toBeLessThanOrEqual(600)
    }
    // Corta em fim de parágrafo quando dá.
    expect(pieces[0]?.body.endsWith('\n\n')).toBe(true)
  })

  it('sem parágrafo, corta depois de frase; sem frase, depois de palavra; sem espaço, no limite', () => {
    const sentences = 'Frase curta aqui. '.repeat(40)
    expect(chunkText(sentences, LABEL, 200)[0]?.body.endsWith('. ')).toBe(true)
    const words = 'palavra '.repeat(60)
    expect(chunkText(words, LABEL, 200)[0]?.body.endsWith(' ')).toBe(true)
    const solid = 'x'.repeat(450)
    const pieces = chunkText(solid, LABEL, 200)
    expect(pieces[0]?.body).toBe('x'.repeat(200))
    expect(pieces.map((piece) => piece.body).join('')).toBe(solid)
  })

  it('rejeita limite inválido e texto vazio', () => {
    expect(() => chunkText('abc', LABEL, 199)).toThrow(RangeError)
    expect(() => chunkText('abc', LABEL, 300.5)).toThrow(RangeError)
    expect(() => chunkText(' \n\n ​ ', LABEL)).toThrow(/texto vazio/)
  })

  it('o texto do embedding junta o caminho de títulos e o conteúdo', () => {
    expect(embeddingText('RCTE > Art. 76 > § 6º', '§ 6º Revogado.')).toBe(
      'RCTE > Art. 76 > § 6º\n\n§ 6º Revogado.',
    )
  })
})

const textArb = fc
  .array(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.constantFrom(' ', '\n', '\n\n', '. ', '; ', '​', 'Ç', 'é'),
    ),
    { minLength: 1, maxLength: 120 },
  )
  .map((parts) => parts.join(''))
  .filter((text) => normalizeForHash(text).length > 0)

describe('propriedades do chunker', () => {
  test.prop([textArb, fc.integer({ min: 200, max: 800 })])(
    'não perde texto: os corpos concatenados reproduzem o texto normalizado',
    (text, max) => {
      const pieces = chunkText(text, LABEL, max)
      expect(pieces.map((piece) => piece.body).join('')).toBe(normalizedParagraphs(text))
      for (const piece of pieces) {
        expect(piece.body.length).toBeLessThanOrEqual(max)
      }
    },
  )

  test.prop([textArb])('é determinístico', (text) => {
    expect(chunkText(text, LABEL, 300)).toEqual(chunkText(text, LABEL, 300))
  })
})
