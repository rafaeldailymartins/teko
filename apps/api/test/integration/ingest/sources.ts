import { createHash } from 'node:crypto'
import type { ValidityInterval } from '@teko/shared/vigencia'
import type {
  ParsedProvision,
  ParsedSource,
  ParsedVersion,
  ReviewFlag,
} from '#domain/corpus/parsed-source.ts'

/**
 * Construtores de `ParsedSource` para os testes de ingestão: um RCTE "de mentira" (consolidado,
 * janela de substituição total) e um Guia (janela = período do leiaute). Os textos são curtos e
 * únicos por teste, para os embeddings virem do fake determinístico.
 */

export function sha(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

export function interval(from: string, to: string | null = null): ValidityInterval {
  return { from, to }
}

export function version(
  text: string,
  validDuring: ValidityInterval,
  options: { readonly label?: string; readonly review?: ReviewFlag } = {},
): ParsedVersion {
  return {
    displayLabel: options.label ?? 'RCTE, art. teste',
    validDuring,
    modality: 'mandatory',
    validityBasis: 'legal_effect',
    retroactive: false,
    reviewStatus: options.review === undefined ? 'auto' : 'pending',
    ...(options.review === undefined ? {} : { review: options.review }),
    text,
  }
}

export function article(
  number: number,
  versions: readonly ParsedVersion[],
  family: 'rcte' | 'efd-icms-ipi' = 'rcte',
): ParsedProvision {
  const stableKey =
    family === 'rcte'
      ? `go:rcte:art:${String(number)}`
      : `br:efd-icms-ipi:reg:C${String(number).padStart(3, '0')}`
  return {
    stableKey,
    kind: family === 'rcte' ? 'artigo' : 'registro',
    sortPath: String(number).padStart(4, '0'),
    headingPath:
      family === 'rcte'
        ? `RCTE > Art. ${String(number)}`
        : `EFD ICMS/IPI > Registro C${String(number).padStart(3, '0')}`,
    versions: versions.map((entry) => ({
      ...entry,
      displayLabel: `${family === 'rcte' ? 'RCTE, art.' : 'Registro C'} ${String(number)}`,
    })),
  }
}

export function rcteSource(
  key: string,
  publishedOn: string,
  provisions: readonly ParsedProvision[],
): ParsedSource {
  return {
    document: {
      slug: 'rcte',
      family: 'rcte',
      title: 'Regulamento do Código Tributário do Estado de Goiás (RCTE)',
      issuer: 'Governo do Estado de Goiás',
      sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
    },
    version: {
      versionLabel: `RCTE consolidado (${key})`,
      publishedOn,
      validDuring: interval(publishedOn),
      consolidatedUntil: key,
      actRef: 'Decreto nº 4.852, de 29.12.97',
      sha256: sha(key),
    },
    replacementWindow: { from: null, to: null },
    provisions,
    skipped: [],
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  }
}

export function guiaSource(
  key: string,
  publishedOn: string,
  period: ValidityInterval,
  provisions: readonly ParsedProvision[],
): ParsedSource {
  return {
    document: {
      slug: 'guia-pratico-efd-icms-ipi',
      family: 'efd-icms-ipi',
      title: 'Guia Prático da EFD ICMS/IPI',
      issuer: 'Receita Federal do Brasil',
      sourceUrl: 'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi',
    },
    version: {
      versionLabel: `Guia Prático (${key})`,
      publishedOn,
      validDuring: period,
      consolidatedUntil: null,
      actRef: 'Ato COTEPE/ICMS 44/2018',
      sha256: sha(key),
    },
    replacementWindow: period,
    provisions: provisions.map((provision) => ({
      ...provision,
      versions: provision.versions.map((entry) => ({ ...entry, validityBasis: 'leiaute_period' })),
    })),
    skipped: [],
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  }
}
