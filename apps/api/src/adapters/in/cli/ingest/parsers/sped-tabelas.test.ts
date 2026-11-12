import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Family, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import { makeInput, makeSource, readFixtureBytes, readFixtureJson } from './docling/testing.ts'
import { type ExternalTableVersion, ParseError, ParserName } from './parser.ts'
import { parseSpedTabela } from './sped-tabelas.ts'

const META_40: ExternalTableVersion = {
  id: 40,
  versao: 5,
  desc: '5.5-  Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS',
  dtVersao: '2024-11-04',
  hash: 'C73DE89E26DBF1A081B86D0B76819AF0131392C9',
}

function sourceFor(meta: ExternalTableVersion | null | undefined) {
  const source = makeSource({
    id: 'tabelas-go/5-5',
    family: Family.TabelasGo,
    parser: ParserName.SpedTabelas,
  })
  return meta === undefined ? source : { ...source, externalTable: meta }
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').toUpperCase()
}

const fixtureSchema = z.object({
  provisions: z.array(
    z.object({
      stableKey: z.string(),
      kind: z.string(),
      parent: z.string().optional(),
      sortPath: z.string(),
      headingPath: z.string(),
      versions: z.array(
        z.object({
          displayLabel: z.string(),
          validDuring: z.object({ from: z.string(), to: z.string().nullable() }),
          validityBasis: z.string(),
          text: z.string(),
        }),
      ),
    }),
  ),
})

function f2(slug: string) {
  return fixtureSchema.parse(
    readFixtureJson(`../../../../../../../test/fixtures/corpus/documents/${slug}.json`),
  ).provisions
}

describe('parseSpedTabela', () => {
  const bytes = readFixtureBytes('tabelas/tabela-40-v5.txt')

  it('reproduz a fixture da F2 da Tabela 5.5 (id 40, versão 5): chaves, títulos, rótulos e textos', () => {
    const parsed = parseSpedTabela(makeInput(sourceFor(META_40), { bytes }))
    const actual = parsed.provisions.map((p) => ({
      stableKey: p.stableKey,
      kind: p.kind,
      parent: p.parent,
      sortPath: p.sortPath,
      headingPath: p.headingPath,
      versions: p.versions.map((v) => ({
        displayLabel: v.displayLabel,
        validDuring: v.validDuring,
        validityBasis: v.validityBasis,
        text: v.text,
      })),
    }))
    expect(actual).toEqual(f2('tabela-go-5-5'))
    expect(parsed.version).toEqual({
      versionLabel: 'Tabela 5.5 (GO), versão 5 de 04/11/2024',
      publishedOn: '2024-11-04',
      validDuring: { from: '2024-11-04', to: null },
      consolidatedUntil: null,
      actRef: null,
      sha256: 'a'.repeat(64),
    })
    expect(parsed.replacementWindow).toEqual({ from: null, to: null })
    expect(parsed.stats).toEqual({ notesTotal: 13, notesParsed: 13, notesToReview: 0 })
    expect(parsed.skipped).toEqual([])
  })

  it('código com duas linhas vira duas redações, como na fixture da 5.3 (recorte da versão 47)', () => {
    const recorte = readFixtureBytes('tabelas/tabela-39-v47-recorte.txt')
    const meta = {
      id: 39,
      versao: 47,
      desc: '5.3 - Tabela de Ajustes e Informações de Valores Provenientes de Documento Fiscal',
      dtVersao: '2026-04-01',
      hash: sha1(recorte),
    }
    const parsed = parseSpedTabela(makeInput(sourceFor(meta), { bytes: recorte }))
    const key = 'go:tabelas-go:tab:5-3:cod:GO00009036'
    const expected = f2('tabela-go-5-3').find((p) => p.stableKey === key)
    const actual = parsed.provisions.find((p) => p.stableKey === key)
    expect(actual?.versions.map((v) => ({ validDuring: v.validDuring, text: v.text }))).toEqual(
      expected?.versions.map((v) => ({ validDuring: v.validDuring, text: v.text })),
    )
    expect(actual?.versions.every((v) => v.validityBasis === ValidityBasis.TableDeclared)).toBe(
      true,
    )
    expect(parsed.provisions[0]?.versions[0]?.text).toBe(
      `${meta.desc}\nversão=47 COD_AJ, DESC_AJ, DT_INI, DT_FIM`,
    )
  })

  function synthetic(lines: readonly string[]) {
    const body = ['versão=5 TIPO_UTIL, DESC_TIPO, DT_INI, DT_FIM', ...lines].join('\r\n')
    // Só caracteres Latin-1, que têm o mesmo código em cp1252 (ã = 0xE3, ç = 0xE7).
    const cp1252 = Uint8Array.from(body, (char) => char.charCodeAt(0))
    return parseSpedTabela(
      makeInput(sourceFor({ ...META_40, hash: sha1(cp1252) }), { bytes: cp1252 }),
    )
  }

  it('linhas sobrepostas do mesmo código vão para revisão; linhas inválidas vão para o log', () => {
    const parsed = synthetic([
      'GO01|Primeira|01012009|31122019',
      'GO01|Segunda|01012015|',
      'GO02|Descrição|com barra|01012009|',
      'GO03|Data ruim|32012009|',
      'GO04|Fim inválido|01012009|99999999',
      'GO05|Fim antes|02012009|01012009',
      'GO-6|Código fora da gramática|01012009|',
      'GO07|curta',
      '',
    ])
    const go01 = parsed.provisions.find((p) => p.stableKey.endsWith(':GO01'))
    expect(go01?.versions.map((v) => v.reviewStatus)).toEqual([
      ReviewStatus.Auto,
      ReviewStatus.Pending,
    ])
    expect(go01?.versions[1]?.review).toEqual({
      reason: 'overlapping-rows',
      rawNote: 'GO01|Segunda|01012015|',
    })
    const go02 = parsed.provisions.find((p) => p.stableKey.endsWith(':GO02'))
    expect(go02?.versions[0]?.text).toBe('GO02 - Descrição - com barra')
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      'invalid-date',
      'invalid-date',
      'empty-interval',
      'malformed-row',
      'invalid-code',
    ])
    expect(parsed.stats).toEqual({ notesTotal: 4, notesParsed: 3, notesToReview: 1 })
  })

  it('tabela sem linhas válidas usa a data da versão no pai', () => {
    const parsed = synthetic([])
    expect(parsed.provisions).toHaveLength(1)
    expect(parsed.provisions[0]?.versions[0]?.validDuring).toEqual({ from: '2024-11-04', to: null })
  })

  it('erros do WS e metadados inconsistentes viram ParseError', () => {
    const erro = readFixtureBytes('tabelas/erro-versao-nao-encontrada.txt')
    expect(() => parseSpedTabela(makeInput(sourceFor(META_40), { bytes: erro }))).toThrow(
      /não é uma tabela: Erro o obter Tabela:VERSAO_TABELA_EXTERNA_NAO_ENCONTRADA/,
    )
    expect(() =>
      parseSpedTabela(makeInput(sourceFor({ ...META_40, versao: 6 }), { bytes })),
    ).toThrow(/TXT da versão 5, metadados da versão 6/)
    expect(() =>
      parseSpedTabela(makeInput(sourceFor({ ...META_40, hash: '0'.repeat(40) }), { bytes })),
    ).toThrow(/SHA-1/)
    expect(() =>
      parseSpedTabela(makeInput(sourceFor({ ...META_40, desc: 'Tabela sem número' }), { bytes })),
    ).toThrow(/número da tabela ausente/)
    expect(() => parseSpedTabela(makeInput(sourceFor(null), { bytes }))).toThrow(
      /source.externalTable/,
    )
    expect(() =>
      parseSpedTabela(makeInput(sourceFor({ ...META_40, hash: 'não é sha-1' }), { bytes })),
    ).toThrow(/source.externalTable/)
    expect(() => parseSpedTabela(makeInput(sourceFor(undefined), { bytes }))).toThrow(
      /source.externalTable/,
    )
    expect(() =>
      parseSpedTabela(makeInput({ ...sourceFor(META_40), family: Family.EfdGo }, { bytes })),
    ).toThrow(ParseError)
  })
})
