import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import { citation } from '../../../test/chat-fixtures.ts'
import { ApiError } from '../api/errors.ts'
import { CoverageStatus, coverageAt } from './coverage.ts'
import { blocksComposer, chatFailure } from './failure.ts'
import {
  allowedLinkPrefixes,
  answerClipboardText,
  citationIdFromHref,
  citationLinksToAnchors,
  hardenOptions,
  isAllowedHref,
} from './markdown.ts'
import { detectPii, removePii } from './pii.ts'
import { citationReference, provisionHref, selectedCitation, stepSelection } from './selection.ts'
import { DATE_COMPARISON_SUGGESTION, SUGGESTIONS } from './suggestions.ts'

describe('detector de PII do composer', () => {
  it('acha CPF, e-mail e telefone com as regras do shared', () => {
    expect(detectPii('Meu CPF é 529.982.247-25 e o e-mail ana@example.com')).toEqual([
      'email',
      'cpf',
    ])
    expect(detectPii('Ligue (62) 99999-8888')).toEqual(['phone'])
  })

  it('não confunde números fiscais (registro, campo, anos) com PII', () => {
    expect(detectPii('Registro C170, campo 07, de 2024-2025, CFOP 5102')).toEqual([])
    expect(detectPii('CPF 529.982.247-26 com DV errado')).toEqual([])
  })

  it('remove os dados trocando pelos marcadores', () => {
    expect(removePii('CPF 529.982.247-25')).toBe('CPF [CPF]')
  })
})

describe('markdown das respostas', () => {
  const origin = 'https://tekoia.vercel.app'

  it('troca cite:S1 pela âncora #cite-S1 e lê o id de volta', () => {
    expect(citationLinksToAnchors('Conforme [S1](cite:S1) e [S12](cite:S12).')).toBe(
      'Conforme [S1](#cite-S1) e [S12](#cite-S12).',
    )
    expect(citationLinksToAnchors('![S1](cite:S0)')).toBe('![S1](cite:S0)')
    expect(citationIdFromHref('#cite-S12')).toBe('S12')
    expect(citationIdFromHref('#cite-S0')).toBeNull()
    expect(citationIdFromHref('https://evil.example/#cite-S1')).toBeNull()
    expect(citationIdFromHref(undefined)).toBeNull()
  })

  it('copiar resposta: citações como [n] e a lista das fontes no fim', () => {
    const sources = [citation('S1'), citation('S2', { label: 'RCTE, art. 76, § 5º' })]
    expect(
      answerClipboardText('Conforme [S1](cite:S1) e [S2](cite:S2), vale.', sources, 'Fontes'),
    ).toBe(
      [
        'Conforme [1] e [2], vale.',
        '',
        'Fontes:',
        '[1] RCTE, art. 76, § 6º: Regulamento do Código Tributário do Estado de Goiás (RCTE consolidado até o Decreto nº 10.986)',
        '[2] RCTE, art. 76, § 5º: Regulamento do Código Tributário do Estado de Goiás (RCTE consolidado até o Decreto nº 10.986)',
      ].join('\n'),
    )
    expect(answerClipboardText(' Sem fontes. ', [], 'Fontes')).toBe('Sem fontes.')
  })

  it('só deixa links para a própria origem e as fontes oficiais', () => {
    expect(allowedLinkPrefixes(origin)[0]).toBe(origin)
    expect(isAllowedHref('https://www.gov.br/sped/guia.pdf', origin)).toBe(true)
    expect(isAllowedHref('https://appasp.economia.go.gov.br/Legislacao/RCTE.htm', origin)).toBe(
      true,
    )
    expect(isAllowedHref('/pt-BR/coverage/', origin)).toBe(true)
    expect(isAllowedHref('https://evil.example/', origin)).toBe(false)
    expect(isAllowedHref('https://www.gov.br.evil.example/', origin)).toBe(false)
    expect(isAllowedHref('javascript:alert(1)', origin)).toBe(false)
    expect(isAllowedHref('mailto:ana@example.com', origin)).toBe(false)
    expect(isAllowedHref('', origin)).toBe(false)
    expect(isAllowedHref('http://[', origin)).toBe(false)
  })

  it('configura o harden sem imagens nem data:', () => {
    expect(hardenOptions(origin)).toMatchObject({
      defaultOrigin: origin,
      allowedImagePrefixes: [],
      allowDataImages: false,
      imageBlockPolicy: 'remove',
    })
  })
})

describe('falha do chat', () => {
  it('lê ApiError, o errorText do stream e erro genérico', () => {
    expect(chatFailure(undefined)).toBeNull()
    const quota = new ApiError({
      code: ErrorCode.QuotaExceeded,
      status: 429,
      problem: {
        type: 'x',
        title: 'Daily quota exceeded',
        status: 429,
        traceId: 't',
        code: 'quota_exceeded',
        meta: { scope: 'user_daily', resetAt: '2026-11-16T03:00:00.000Z' },
      },
    })
    expect(chatFailure(quota)).toEqual({
      code: 'quota_exceeded',
      retryable: true,
      resetAt: '2026-11-16T03:00:00.000Z',
    })
    expect(chatFailure(new Error('{"code":"stream_busy","retryable":true}'))).toEqual({
      code: 'stream_busy',
      retryable: true,
      resetAt: null,
    })
    expect(chatFailure(new Error('Failed to fetch'))?.code).toBe('internal')
  })

  it('cota e serviço pausado bloqueiam o composer', () => {
    expect(blocksComposer(null)).toBe(false)
    expect(blocksComposer({ code: 'quota_exceeded', retryable: true, resetAt: null })).toBe(true)
    expect(blocksComposer({ code: 'service_paused', retryable: true, resetAt: null })).toBe(true)
    expect(blocksComposer({ code: 'internal', retryable: true, resetAt: null })).toBe(false)
  })
})

describe('cobertura na data', () => {
  const families = [
    {
      family: 'rcte',
      jurisdiction: 'GO' as const,
      covered: [{ from: '1998-01-01', to: null }],
      verifiedAt: '2026-11-10',
    },
    {
      family: 'efd-icms-ipi',
      jurisdiction: 'BR' as const,
      covered: [{ from: '2021-01-01', to: null }],
      verifiedAt: '2026-11-10',
    },
  ]

  it('fundamentada, parcial e fora de cobertura', () => {
    expect(coverageAt(families, '2024-03-01')).toEqual({
      status: CoverageStatus.Grounded,
      uncovered: [],
    })
    expect(coverageAt(families, '2008-05-01')).toEqual({
      status: CoverageStatus.Partial,
      uncovered: ['efd-icms-ipi'],
    })
    expect(coverageAt(families, '1990-01-01').status).toBe(CoverageStatus.Out)
  })
})

describe('seleção de citação', () => {
  const selection = {
    citations: [citation('S1'), citation('S2')],
    index: 0,
    questionId: null,
    referenceDate: '2008-05-01',
  }

  it('anda com [ e ] sem dar a volta', () => {
    expect(stepSelection(selection, 1).index).toBe(1)
    expect(stepSelection(stepSelection(selection, 1), 1).index).toBe(1)
    expect(stepSelection(selection, -1)).toBe(selection)
    expect(selectedCitation(selection)?.id).toBe('S1')
    expect(selectedCitation(null)).toBeNull()
  })

  it('monta o link do dispositivo com a data usada', () => {
    expect(provisionHref('pt-BR', 'go:rcte:art:76:par:6', '2008-05-01')).toBe(
      '/pt-BR/provision/?k=go%3Arcte%3Aart%3A76%3Apar%3A6&ref=2008-05-01',
    )
    expect(provisionHref('en', 'go:rcte:art:76', null)).toBe(
      '/en/provision/?k=go%3Arcte%3Aart%3A76',
    )
  })

  it('monta o texto de copiar citação', () => {
    expect(citationReference(citation('S1'), 'Vigência: 04/11/2004 a 22/11/2009')).toBe(
      [
        'RCTE, art. 76, § 6º',
        'Regulamento do Código Tributário do Estado de Goiás (RCTE consolidado até o Decreto nº 10.986)',
        'Vigência: 04/11/2004 a 22/11/2009',
        'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
      ].join('\n'),
    )
  })
})

describe('sugestões', () => {
  it('o destaque é a pergunta do DoD em 05/2008 contra 01/2010', () => {
    expect(DATE_COMPARISON_SUGGESTION.periods).toEqual(['2008-05', '2010-01'])
    expect(DATE_COMPARISON_SUGGESTION.question).toBe('rcte76')
  })

  it('nenhuma pergunta se repete, e as famílias do corpus aparecem', () => {
    const questions = [DATE_COMPARISON_SUGGESTION, ...SUGGESTIONS].map((item) => item.question)
    expect(new Set(questions).size).toBe(questions.length)
    expect(new Set(SUGGESTIONS.map((item) => item.family))).toEqual(
      new Set(['efd-icms-ipi', 'efd-reinf', 'rcte', 'efd-go']),
    )
  })
})
