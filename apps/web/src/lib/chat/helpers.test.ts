import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import { citation } from '../../../test/chat-fixtures.ts'
import { ApiError } from '../api/errors.ts'
import { CoverageStatus, coverageAt } from './coverage.ts'
import { blocksComposer, chatFailure } from './failure.ts'
import {
  formatIsoDate,
  formatPeriodo,
  intervalDisplay,
  ValidityStatus,
  validityStatus,
} from './format.ts'
import {
  allowedLinkPrefixes,
  citationIdFromHref,
  citationLinksToAnchors,
  hardenOptions,
  isAllowedHref,
} from './markdown.ts'
import { detectPii, removePii } from './pii.ts'
import { citationReference, provisionHref, selectedCitation, stepSelection } from './selection.ts'
import { DATE_SENSITIVE_SUGGESTIONS } from './suggestions.ts'

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

describe('formatação', () => {
  it('formata data no locale, sem escorregar o dia, e o período em MM/AAAA', () => {
    expect(formatIsoDate('2008-05-01', 'pt-BR')).toBe('01/05/2008')
    expect(formatIsoDate('2008-05-01', 'en')).toBe('05/01/2008')
    expect(formatPeriodo('2008-05')).toBe('05/2008')
  })

  it('exibe o último dia incluído do intervalo', () => {
    expect(intervalDisplay({ from: '2004-11-04', to: '2009-11-23' }, 'pt-BR')).toEqual({
      from: '04/11/2004',
      to: '22/11/2009',
    })
    expect(intervalDisplay({ from: null, to: null }, 'pt-BR')).toEqual({ from: null, to: null })
  })

  it('situação da redação hoje', () => {
    const today = '2026-11-15'
    expect(validityStatus({ from: '2009-11-23', to: null }, today)).toBe(ValidityStatus.Current)
    expect(validityStatus({ from: '2004-11-04', to: '2009-11-23' }, today)).toBe(
      ValidityStatus.Superseded,
    )
    expect(validityStatus({ from: '2027-01-01', to: null }, today)).toBe(ValidityStatus.Future)
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
  it('cobrem os pares de períodos do DoD', () => {
    expect(DATE_SENSITIVE_SUGGESTIONS.map((item) => item.periods)).toEqual([
      ['2008-05', '2010-01'],
      ['2004-03', '2006-05'],
    ])
  })
})
