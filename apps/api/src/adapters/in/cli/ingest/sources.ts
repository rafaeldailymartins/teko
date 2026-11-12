import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type IsoDate, isoDateSchema, type ValidityInterval } from '@teko/shared/vigencia'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { FAMILIES, type Family } from '#domain/corpus/family.ts'
import { leiautePeriodIntervals, publicationIntervals } from '#domain/corpus/leiaute-validity.ts'
import { ParserName, type SourceDescriptor } from './parsers/parser.ts'

/**
 * `corpus/sources.yaml` e `corpus/leiaute-periods.yaml`: o manifesto das fontes das ondas C1 e C2
 * e os períodos de leiaute curados do Ato COTEPE/ICMS 44/2018 e dos ADE Cofis da EFD-REINF. O
 * schema valida os dois arquivos juntos (cada fonte de validade `leiaute` precisa de um período
 * conhecido) e resolve cada fonte num `SourceDescriptor`, com as datas calculadas:
 *
 * - `leiaute` (Guia Prático, leiautes da REINF): `versionValidDuring` = do início do período da
 *   versão até o início do período seguinte entre as versões habilitadas do mesmo documento
 *   (`leiautePeriodIntervals`); versões corretivas do mesmo período recebem o mesmo intervalo;
 * - `nt`: o período do leiaute a que a NT pertence; `effective_from`/`mandatory_from`, quando não
 *   declarados, são o início desse período;
 * - `publication` (Guia EFD-GO): `[published_on, próxima publicação)`;
 * - `consolidated` (RCTE, CTE) e `table` (Tabelas GO): sem vigência de documento (vem do conteúdo).
 *
 * Modos de download: `pinned` (arquivo imutável, sha256 obrigatório e conferido), `live` (página
 * que muda: RCTE.htm, CTE.htm; o sha256 identifica a versão baixada) e `ws-tabela` (WS de Tabelas
 * Externas: a versão atual vem do `consultarVersoesTabelasExternas`).
 */

export const SourceMode = {
  Pinned: 'pinned',
  Live: 'live',
  WsTabela: 'ws-tabela',
} as const
export type SourceMode = (typeof SourceMode)[keyof typeof SourceMode]

const DocumentValidity = {
  Leiaute: 'leiaute',
  Nt: 'nt',
  Publication: 'publication',
  Consolidated: 'consolidated',
  Table: 'table',
} as const

export const SourceFormat = {
  Pdf: 'pdf',
  Xlsx: 'xlsx',
  Htm: 'htm',
  Txt: 'txt',
  Zip: 'zip',
} as const
export type SourceFormat = (typeof SourceFormat)[keyof typeof SourceFormat]

/** Formatos que passam pelo Docling no job `extract`. */
export const DOCLING_FORMATS: ReadonlySet<SourceFormat> = new Set([
  SourceFormat.Pdf,
  SourceFormat.Xlsx,
])

/** URL do `consultarVersoesTabelasExternas` (GET; `metadadosXml` com uma `tabela` por id). */
export const WS_TABELAS_VERSIONS_URL =
  'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/WsConsulta.asmx/consultarVersoesTabelasExternas?codigoSistema=SpedFiscal'
/** Download de uma versão de tabela: `?idTabela=<id>&versao=<versao>`. */
export const WS_TABELAS_DOWNLOAD_URL =
  'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx'

const httpsUrl = z.url({ protocol: /^https$/, error: 'URL https obrigatória' })
const anyUrl = z.url({ protocol: /^https?$/ })
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, { error: 'sha256 hexadecimal minúsculo' })
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
/** Rótulo curto da versão, usado nas chaves do Blobs (`3.2.4`, `2.1.2d`, `5.9`). */
const versionSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,40}$/)
/** `efd-icms-ipi/guia-pratico/3.2.4`, `efd-icms-ipi/nt/2025-001`, `tabelas-go/5-1-1`. */
const sourceIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9./_-]*$/)
  .max(120)
const pageRangeSchema = z
  .string()
  .regex(/^\d+-\d+$/)
  .refine(
    (value) => {
      const [start, end] = value.split('-').map(Number)
      return start !== undefined && end !== undefined && start >= 1 && start <= end
    },
    { error: 'page_range: início ≥ 1 e início ≤ fim' },
  )

const sourceSchema = z
  .strictObject({
    id: sourceIdSchema,
    /** Rótulo curto (chaves do Blobs e de `leiaute-periods.yaml`). */
    version: versionSchema.optional(),
    /** Rótulo exibido da versão de documento (como na fixture da F2). */
    version_label: z.string().trim().min(1).optional(),
    url: anyUrl,
    mode: z.enum(SourceMode),
    sha256: sha256Schema.optional(),
    format: z.enum(SourceFormat),
    published_on: isoDateSchema.optional(),
    act_ref: z.string().trim().min(1).optional(),
    /** Código do período de leiaute (`leiaute-periods.yaml`), nas validades `leiaute` e `nt`. */
    leiaute: z.string().trim().min(1).optional(),
    effective_from: isoDateSchema.optional(),
    optional_from: isoDateSchema.optional(),
    mandatory_from: isoDateSchema.optional(),
    year_pivot: z.int().min(0).max(99).optional(),
    ocr: z.boolean().default(false),
    /** Páginas (base 1, inclusivas) de cada parte do Docling; vazio = documento inteiro. */
    page_ranges: z.array(pageRangeSchema).default([]),
    pages: z.int().positive().optional(),
    /** `document_timeout` do Docling por parte (padrão 3.600 s; teto do job: 18.000 s). */
    timeout_seconds: z.int().min(60).max(18_000).optional(),
    /** `idTabela` do WS de Tabelas Externas (modo `ws-tabela`). */
    ws_table_id: z.int().positive().optional(),
    /** `false` mantém a fonte registrada sem baixar (com o motivo em `disabled_reason`). */
    enabled: z.boolean().default(true),
    disabled_reason: z.string().trim().min(1).optional(),
    notes: z.string().optional(),
  })
  .superRefine((source, ctx) => {
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message })
    }
    if (!source.enabled) {
      if (source.disabled_reason === undefined) {
        issue('disabled_reason', 'obrigatório com enabled: false')
      }
      return
    }
    if (!source.url.startsWith('https://')) {
      issue('url', 'fonte habilitada precisa de URL https (o SafeFetcher só aceita https)')
    }
    if (source.mode === SourceMode.Pinned && source.sha256 === undefined) {
      issue('sha256', 'obrigatório no modo pinned')
    }
    if (source.mode === SourceMode.WsTabela && source.ws_table_id === undefined) {
      issue('ws_table_id', 'obrigatório no modo ws-tabela')
    }
    if (source.page_ranges.length > 0 && !DOCLING_FORMATS.has(source.format)) {
      issue('page_ranges', 'só para PDF/XLSX')
    }
  })

type SourceEntry = z.output<typeof sourceSchema>

const documentSchema = z
  .strictObject({
    slug: slugSchema,
    family: z.enum(FAMILIES),
    title: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    source_url: httpsUrl,
    parser: z.enum(ParserName),
    validity: z.enum(DocumentValidity),
    act_ref: z.string().trim().min(1).optional(),
    sources: z.array(sourceSchema).min(1),
  })
  .superRefine((document, ctx) => {
    for (const [index, source] of document.sources.entries()) {
      const issue = (path: string, message: string) => {
        ctx.addIssue({ code: 'custom', path: ['sources', index, path], message })
      }
      if (!source.id.startsWith(`${document.family}/`)) {
        issue('id', `id precisa começar com "${document.family}/"`)
      }
      if (!source.enabled) {
        continue
      }
      const needsDates =
        document.validity === DocumentValidity.Leiaute ||
        document.validity === DocumentValidity.Nt ||
        document.validity === DocumentValidity.Publication
      if (needsDates) {
        for (const field of ['version', 'version_label', 'published_on'] as const) {
          if (source[field] === undefined) {
            issue(field, `obrigatório com validity ${document.validity}`)
          }
        }
      }
      if (
        (document.validity === DocumentValidity.Leiaute ||
          document.validity === DocumentValidity.Nt) &&
        source.leiaute === undefined
      ) {
        issue('leiaute', `obrigatório com validity ${document.validity}`)
      }
    }
  })

type DocumentEntry = z.output<typeof documentSchema>

const sourcesFileSchema = z
  .strictObject({
    version: z.literal(1),
    documents: z.array(documentSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>()
    const slugs = new Set<string>()
    for (const [docIndex, document] of file.documents.entries()) {
      if (slugs.has(document.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['documents', docIndex, 'slug'],
          message: 'slug repetido',
        })
      }
      slugs.add(document.slug)
      const versions = new Set<string>()
      for (const [index, source] of document.sources.entries()) {
        const path = ['documents', docIndex, 'sources', index]
        if (ids.has(source.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'id'],
            message: `id repetido: ${source.id}`,
          })
        }
        ids.add(source.id)
        if (source.version !== undefined) {
          if (versions.has(source.version)) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'version'],
              message: 'versão repetida no documento',
            })
          }
          versions.add(source.version)
        }
      }
    }
  })

type SourcesFile = z.output<typeof sourcesFileSchema>

const leiautePeriodSchema = z
  .strictObject({
    code: z.string().trim().min(1),
    /** Início (inclusivo) do período. */
    from: isoDateSchema,
    /** Fim exclusivo (`[from, to)`); `null` = em aberto. */
    to: isoDateSchema.nullable(),
    act: z.string().trim().min(1),
    note: z.string().optional(),
  })
  .refine((period) => period.to === null || period.from < period.to, {
    error: 'período vazio: from precisa ser anterior a to',
    path: ['to'],
  })

const leiauteSeriesSchema = z.strictObject({
  title: z.string().trim().min(1),
  source_url: httpsUrl,
  periods: z.array(leiautePeriodSchema).min(1),
})

/** `leiaute-periods.yaml`: uma série de períodos por família (EFD ICMS/IPI e EFD-REINF). */
const leiautePeriodsFileSchema = z
  .strictObject({
    version: z.literal(1),
    series: z.partialRecord(z.enum(FAMILIES), leiauteSeriesSchema),
  })
  .superRefine((file, ctx) => {
    for (const [family, series] of Object.entries(file.series)) {
      const codes = new Set<string>()
      for (const [index, period] of (series?.periods ?? []).entries()) {
        if (codes.has(period.code)) {
          ctx.addIssue({
            code: 'custom',
            path: ['series', family, 'periods', index, 'code'],
            message: `código repetido: ${period.code}`,
          })
        }
        codes.add(period.code)
      }
    }
  })

type LeiautePeriodsFile = z.output<typeof leiautePeriodsFileSchema>

export class CorpusConfigError extends Error {
  constructor(file: string, detail: string, options?: { readonly cause?: unknown }) {
    super(`${file}: ${detail}`, options)
    this.name = 'CorpusConfigError'
  }
}

/** Descritor resolvido de uma fonte habilitada, com o que o pipeline precisa além do contrato. */
export interface ResolvedSource extends SourceDescriptor {
  readonly version: string | null
  readonly mode: SourceMode
  readonly format: SourceFormat
  readonly sha256: string | null
  readonly ocr: boolean
  readonly pageRanges: readonly string[]
  readonly timeoutSeconds: number | null
  readonly wsTableId: number | null
}

export interface CorpusConfig {
  readonly sources: SourcesFile
  readonly leiautes: LeiautePeriodsFile
  /** Fontes habilitadas, resolvidas, na ordem do arquivo. */
  readonly resolved: readonly ResolvedSource[]
}

function readYaml(file: string): unknown {
  return parseYaml(readFileSync(file, 'utf8'))
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('; ')
}

function periodOf(
  leiautes: LeiautePeriodsFile,
  family: Family,
  code: string,
): z.output<typeof leiautePeriodSchema> | undefined {
  return leiautes.series[family]?.periods.find((period) => period.code === code)
}

/** Vigência de documento de cada versão habilitada (por `version`), conforme a validade. */
function documentIntervals(
  document: DocumentEntry,
  leiautes: LeiautePeriodsFile,
): ReadonlyMap<string, ValidityInterval> {
  const enabled = document.sources.filter((source) => source.enabled)
  switch (document.validity) {
    case DocumentValidity.Leiaute:
      return leiautePeriodIntervals(
        enabled.map((source) => ({
          id: source.version ?? source.id,
          from: periodOf(leiautes, document.family, source.leiaute ?? '')?.from ?? '',
        })),
      )
    case DocumentValidity.Nt: {
      const intervals = new Map<string, ValidityInterval>()
      for (const source of enabled) {
        const period = periodOf(leiautes, document.family, source.leiaute ?? '')
        if (period !== undefined) {
          intervals.set(source.version ?? source.id, { from: period.from, to: period.to })
        }
      }
      return intervals
    }
    case DocumentValidity.Publication: {
      const byDate = publicationIntervals(enabled.map((source) => source.published_on ?? ''))
      return new Map(
        enabled.flatMap((source) => {
          const interval = byDate.get(source.published_on ?? '')
          return interval === undefined ? [] : [[source.version ?? source.id, interval] as const]
        }),
      )
    }
    default:
      return new Map()
  }
}

function resolveSource(
  document: DocumentEntry,
  source: SourceEntry,
  intervals: ReadonlyMap<string, ValidityInterval>,
  leiautes: LeiautePeriodsFile,
): ResolvedSource {
  const key = source.version ?? source.id
  const period =
    source.leiaute === undefined ? undefined : periodOf(leiautes, document.family, source.leiaute)
  const isNt = document.validity === DocumentValidity.Nt
  const ntStart: IsoDate | null = isNt ? (period?.from ?? null) : null
  return {
    id: source.id,
    family: document.family,
    parser: document.parser,
    url: source.url,
    document: {
      slug: document.slug,
      family: document.family,
      title: document.title,
      issuer: document.issuer,
      sourceUrl: document.source_url,
    },
    versionLabel: source.version_label ?? null,
    publishedOn: source.published_on ?? null,
    versionValidDuring: intervals.get(key) ?? null,
    effectiveFrom: source.effective_from ?? ntStart,
    optionalFrom: source.optional_from ?? null,
    mandatoryFrom: source.mandatory_from ?? ntStart,
    yearPivot: source.year_pivot ?? null,
    actRef: source.act_ref ?? document.act_ref ?? null,
    version: source.version ?? null,
    mode: source.mode,
    format: source.format,
    sha256: source.sha256 ?? null,
    ocr: source.ocr,
    pageRanges: source.page_ranges,
    timeoutSeconds: source.timeout_seconds ?? null,
    wsTableId: source.ws_table_id ?? null,
  }
}

/**
 * Valida os dois arquivos juntos e resolve as fontes habilitadas. Lança `CorpusConfigError` com
 * todos os problemas encontrados.
 */
export function buildCorpusConfig(sourcesRaw: unknown, leiautesRaw: unknown): CorpusConfig {
  const sources = sourcesFileSchema.safeParse(sourcesRaw)
  if (!sources.success) {
    throw new CorpusConfigError('sources.yaml', formatIssues(sources.error), {
      cause: sources.error,
    })
  }
  const leiautes = leiautePeriodsFileSchema.safeParse(leiautesRaw)
  if (!leiautes.success) {
    throw new CorpusConfigError('leiaute-periods.yaml', formatIssues(leiautes.error), {
      cause: leiautes.error,
    })
  }
  const problems: string[] = []
  for (const document of sources.data.documents) {
    for (const source of document.sources) {
      if (source.enabled && source.leiaute !== undefined) {
        if (periodOf(leiautes.data, document.family, source.leiaute) === undefined) {
          problems.push(
            `${source.id}: período de leiaute desconhecido (${document.family} ${source.leiaute})`,
          )
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new CorpusConfigError('sources.yaml', problems.join('; '))
  }
  const resolved = sources.data.documents.flatMap((document) => {
    const intervals = documentIntervals(document, leiautes.data)
    return document.sources
      .filter((source) => source.enabled)
      .map((source) => resolveSource(document, source, intervals, leiautes.data))
  })
  return { sources: sources.data, leiautes: leiautes.data, resolved }
}

/** Lê `sources.yaml` e `leiaute-periods.yaml` de `corpus/`. */
export function loadCorpusConfig(corpusDir: string): CorpusConfig {
  return buildCorpusConfig(
    readYaml(join(corpusDir, 'sources.yaml')),
    readYaml(join(corpusDir, 'leiaute-periods.yaml')),
  )
}

/** Hosts das fontes habilitadas (allowlist do SafeFetcher), em ordem. */
export function allowedHostsOf(config: CorpusConfig): string[] {
  const hosts = new Set<string>()
  for (const source of config.resolved) {
    hosts.add(new URL(source.url).hostname)
    if (source.mode === SourceMode.WsTabela) {
      hosts.add(new URL(WS_TABELAS_VERSIONS_URL).hostname)
    }
  }
  return [...hosts].sort()
}
