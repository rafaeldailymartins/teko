import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../../../../test/setup/repo-root.ts'
import { doclingBlobKey, doclingPartId, rawBlobKey, slugify } from './blob-keys.ts'
import { CliUsageError, EXIT_USAGE, errorMessage, isIngestTarget } from './cli-common.ts'
import {
  CorpusLockError,
  EMPTY_LOCK,
  nextCorpusLock,
  readCorpusLock,
  serializeCorpusLock,
  writeCorpusLock,
} from './corpus-lock.ts'
import { PARSER_REVISIONS, PARSERS } from './parsers/index.ts'
import { ParserName } from './parsers/parser.ts'
import { parseTableVersions, tableDownloadUrl, WsTabelasError } from './ws-tabelas.ts'

const SHA = 'f'.repeat(64)

describe('blob-keys', () => {
  it('monta as chaves {family}/{docSlug}/{versão}/{sha256}.{ext}', () => {
    const parts = {
      family: 'efd-icms-ipi',
      documentSlug: 'guia-pratico-efd-icms-ipi',
      version: '3.2.4',
      sha256: SHA,
    } as const
    expect(rawBlobKey(parts, 'pdf')).toBe(`efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${SHA}.pdf`)
    expect(doclingBlobKey(parts, null)).toBe(
      `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${SHA}.json`,
    )
    expect(doclingBlobKey(parts, '1-125')).toBe(
      `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${SHA}-p1-125.json`,
    )
    expect(doclingPartId(SHA, '126-250')).toBe(`${SHA}-p126-250`)
  })

  it('slugifica rótulos longos sem acento nem barra', () => {
    expect(slugify('RCTE consolidado até o Decreto nº 10.986, de 16.09.26')).toBe(
      'rcte-consolidado-ate-o-decreto-n-10.986-de-16.09.26',
    )
    expect(slugify(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79))
  })
})

describe('cli-common', () => {
  it('valida o alvo e formata erros', () => {
    expect(isIngestTarget('staging')).toBe(true)
    expect(isIngestTarget('production')).toBe(true)
    expect(isIngestTarget('fixture')).toBe(false)
    expect(new CliUsageError('x', 'uso').exitCode).toBe(EXIT_USAGE)
    expect(errorMessage(new RangeError('r'))).toBe('RangeError: r')
    expect(errorMessage('texto')).toBe('texto')
  })
})

describe('parsers/index', () => {
  it('registra um parser por nome do sources.yaml', () => {
    expect(Object.keys(PARSERS).sort()).toEqual(Object.values(ParserName).sort())
    for (const parser of Object.values(PARSERS)) {
      expect(typeof parser).toBe('function')
    }
  })

  it('cada parser tem uma revisão inteira positiva (ADR 0026)', () => {
    expect(Object.keys(PARSER_REVISIONS).sort()).toEqual(Object.values(ParserName).sort())
    for (const revision of Object.values(PARSER_REVISIONS)) {
      expect(Number.isInteger(revision) && revision >= 1).toBe(true)
    }
    // A correção do registro 0000 e das linhas fundidas (#33) sobe o docling-guia para 2.
    expect(PARSER_REVISIONS[ParserName.DoclingGuia]).toBe(2)
  })
})

const WS_XML = `<?xml version="1.0" encoding="utf-8"?>
<RetornoVersoesTabelasExternas xmlns="http://www.sped.fazenda.gov.br/sped/tabelas/ConsultaVersoes">
  <codigoRetorno>101</codigoRetorno>
  <metadadosXml>&lt;sistema cod="SpedFiscal"&gt;&lt;tabelas dthc="2026-11-09" versao="1959"&gt;&lt;tabela id="40" tipo="TP_UTIL_CRED_FISCAIS" desc="5.5-  Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS" versao="5" dtCriacao="2008-12-23" dtVersao="2024-11-04" hash="C73DE89E26DBF1A081B86D0B76819AF0131392C9" /&gt;&lt;tabela id="38" desc="5.2 - A &amp;amp; B" versao="51" dtVersao="2026-09-21" hash="81F05295AA5DD5171CFA49E8223E986ECD5355DC"/&gt;&lt;tabela id="99" desc="sem versão" /&gt;&lt;/tabelas&gt;&lt;/sistema&gt;</metadadosXml>
</RetornoVersoesTabelasExternas>`

describe('ws-tabelas', () => {
  it('lê as versões atuais do metadadosXml', () => {
    const tables = parseTableVersions(WS_XML)
    expect(tables.get(40)).toEqual({
      id: 40,
      versao: 5,
      desc: '5.5-  Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS',
      dtVersao: '2024-11-04',
      hash: 'C73DE89E26DBF1A081B86D0B76819AF0131392C9',
    })
    expect(tables.get(38)?.desc).toBe('5.2 - A & B')
    expect(tables.has(99)).toBe(false)
    expect(
      tableDownloadUrl(
        'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx',
        tables.get(40) ?? { id: 0, versao: 0, desc: '', dtVersao: '', hash: '' },
      ),
    ).toBe(
      'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40&versao=5',
    )
  })

  it('recusa resposta sem codigoRetorno ou sem tabelas', () => {
    expect(() => parseTableVersions('<html>erro</html>')).toThrow(WsTabelasError)
    expect(() => parseTableVersions('<codigoRetorno>99</codigoRetorno>')).toThrow(
      /sem tabelas \(codigoRetorno 99\)/,
    )
  })
})

describe('corpus-lock', () => {
  const snapshot = {
    manifestKey: 'snapshots/3/manifest.json',
    corpusVersion: 3,
    createdAt: '2026-11-11T12:00:00.000Z',
    migration: 'abc',
    manifestSha256: SHA,
  }
  const source = { sha256: SHA, versionLabel: 'Guia 3.2.4', publishedOn: '2026-07-30' }

  it('lock vazio quando o arquivo não existe; lê e grava em ordem estável', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teko-lock-'))
    const file = join(dir, 'corpus.lock.json')
    expect(readCorpusLock(file)).toEqual(EMPTY_LOCK)
    const next = nextCorpusLock(EMPTY_LOCK, {
      snapshot,
      sources: { 'z/1': source, 'a/1': source },
      today: '2026-11-11',
    })
    expect(next).toMatchObject({ corpusVersion: 3, updatedAt: '2026-11-11' })
    writeCorpusLock(file, next ?? EMPTY_LOCK)
    const text = readFileSync(file, 'utf8')
    expect(text.indexOf('"a/1"')).toBeLessThan(text.indexOf('"z/1"'))
    expect(readCorpusLock(file)).toEqual(next)
  })

  it('não muda nada sem snapshot nem fonte nova', () => {
    const current = nextCorpusLock(EMPTY_LOCK, {
      snapshot,
      sources: { 'a/1': source },
      today: '2026-11-10',
    })
    expect(current).not.toBeNull()
    const base = current ?? EMPTY_LOCK
    expect(
      nextCorpusLock(base, { snapshot: null, sources: { 'a/1': source }, today: '2026-11-11' }),
    ).toBeNull()
    expect(
      nextCorpusLock(base, {
        snapshot: null,
        sources: { 'a/1': { ...source, sha256: 'e'.repeat(64) } },
        today: '2026-11-11',
      })?.updatedAt,
    ).toBe('2026-11-11')
    expect(serializeCorpusLock(EMPTY_LOCK).endsWith('}\n')).toBe(true)
  })

  it('recusa lock fora do formato', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teko-lock-'))
    const file = join(dir, 'corpus.lock.json')
    writeFileSync(file, '{"format": 2}')
    expect(() => readCorpusLock(file)).toThrow(CorpusLockError)
  })

  it('o corpus/corpus.lock.json versionado é o lock inicial', () => {
    expect(readCorpusLock(repoPath('corpus', 'corpus.lock.json'))).toEqual(EMPTY_LOCK)
  })
})
