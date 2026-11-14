import { describe, expect, it } from 'vitest'
import { cacheKeyMaterial, normalizeQuestion } from './cache-key.ts'

describe('normalizeQuestion', () => {
  it('ignora caixa, espaços extras, pontuação final e formas Unicode equivalentes', () => {
    expect(normalizeQuestion('  Qual  a ALÍQUOTA?! ')).toBe('qual a alíquota')
    expect(normalizeQuestion('ﬁm.')).toBe('fim')
    expect(normalizeQuestion('C170 campo 07')).toBe('c170 campo 07')
  })
})

describe('cacheKeyMaterial', () => {
  const base = {
    question: 'Qual a alíquota?',
    referenceDate: '2024-05-01',
    corpusVersion: 14,
    promptVersion: 'answer@1.0.0+abcd1234',
    modelFamily: 'default',
    locale: 'pt-BR',
    families: ['rcte', 'cte'],
  } as const

  it('junta todas as partes, com famílias ordenadas', () => {
    expect(cacheKeyMaterial(base)).toBe(
      'qual a alíquota|2024-05-01|14|answer@1.0.0+abcd1234|default|pt-BR|cte,rcte',
    )
  })

  it('qualquer parte diferente muda a chave', () => {
    const key = cacheKeyMaterial(base)
    for (const change of [
      { referenceDate: '2024-06-01' },
      { corpusVersion: 15 },
      { promptVersion: 'answer@1.0.1+abcd1234' },
      { modelFamily: 'zdr' as const },
      { locale: 'en' },
      { families: ['rcte'] },
    ]) {
      expect(cacheKeyMaterial({ ...base, ...change })).not.toBe(key)
    }
  })
})
