import { type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'
import { z } from 'zod'
import type { Family } from '#domain/corpus/family.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import { type BlobStore, BlobStoreName } from '../ports/blob-store.ts'
import type { Clock } from '../ports/clock.ts'
import type { SafeFetcher } from '../ports/safe-fetcher.ts'
import {
  type DiscoveredChange,
  DiscoveredKind,
  type DiscoveredReport,
  type WatchPageError,
} from '../ports/watch-report.ts'
import {
  type PageSignals,
  type WatchedItem,
  WatchKind,
  type WatchPage,
  type WatchSignalReader,
} from '../ports/watch-signals.ts'

/**
 * `WatchSources` (job `detect` do `source-watch.yml`): GET condicional de cada página do
 * `corpus/watch.yaml`, com ETag e Last-Modified guardados em `corpus-manifests/watch-state.json`,
 * comparação dos sinais de versão com o estado anterior e gravação do `discovered.json`. Não toca o
 * banco: quem marca a cobertura é o `MarkCoverage`, em outro job e com outro environment.
 *
 * Regras:
 * - Primeira observação de uma página (ou URL nova, como o sumário de um ano novo) grava a linha de
 *   base sem reportar mudança.
 * - `304` mantém o estado; `404` numa URL com `{yyyy}` conta como página ainda vazia; outro erro
 *   (rede, bloqueio do SafeFetcher, status inesperado, sinal ausente) vai para `errors`, e a família
 *   fica em `unverifiedFamilies` (o `verified_at` dela não avança).
 * - Ato novo numa `act-list` fica pendente enquanto o consolidado da família não o alcançar
 *   (número do ato maior que o do rótulo "CONSOLIDADO ATÉ…"); pendentes são reapresentados a cada
 *   run com `status: 'pending'`, para a lacuna continuar marcada.
 * - `effectiveFrom` é a data informada pela fonte (DOE do ato, data do rótulo, `dtVersao`) ou, se
 *   não houver, a data do run.
 */

export const WATCH_STATE_KEY = 'watch-state.json'
export const DISCOVERED_KEY = 'discovered.json'

const pendingActSchema = z.object({
  family: z.string(),
  number: z.number().int(),
  versionLabel: z.string().nullable(),
  effectiveFrom: z.string(),
  sourceUrl: z.string(),
  detectedOn: z.string(),
})
type PendingAct = z.infer<typeof pendingActSchema>

const pageStateSchema = z.object({
  url: z.string(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  checkedOn: z.string(),
  label: z.string().nullable(),
  labelNumber: z.number().int().nullable(),
  items: z.record(z.string(), z.string()),
  pending: z.array(pendingActSchema),
})
type PageState = z.infer<typeof pageStateSchema>

const watchStateSchema = z.object({
  schemaVersion: z.literal(1),
  pages: z.record(z.string(), pageStateSchema),
})
type WatchState = z.infer<typeof watchStateSchema>

export interface WatchSourcesDeps {
  readonly fetcher: SafeFetcher
  readonly blobs: BlobStore
  readonly reader: WatchSignalReader
  readonly clock: Clock
}

export interface WatchSourcesCommand {
  readonly pages: readonly WatchPage[]
  /** Não grava estado nem `discovered.json` no Blobs (só devolve o relatório). */
  readonly dryRun?: boolean
}

export class WatchStateError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'WatchStateError'
  }
}

/** Troca `{yyyy}` pelo ano do run. */
export function resolvePageUrl(url: string, runDate: IsoDate): string {
  return url.replaceAll('{yyyy}', runDate.slice(0, 4))
}

function isTemplated(page: WatchPage): boolean {
  return page.url.includes('{yyyy}')
}

async function loadState(blobs: BlobStore): Promise<WatchState> {
  const raw = await blobs.get(BlobStoreName.CorpusManifests, WATCH_STATE_KEY)
  if (raw === null) {
    return { schemaVersion: 1, pages: {} }
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch (error) {
    throw new WatchStateError(`${WATCH_STATE_KEY} não é JSON válido`, { cause: error })
  }
  const parsed = watchStateSchema.safeParse(json)
  if (!parsed.success) {
    throw new WatchStateError(`${WATCH_STATE_KEY} inválido: ${parsed.error.message}`)
  }
  return parsed.data
}

function conditionalHeaders(previous: PageState | undefined, url: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (previous === undefined || previous.url !== url) {
    return headers
  }
  if (previous.etag !== null) {
    headers['if-none-match'] = previous.etag
  }
  if (previous.lastModified !== null) {
    headers['if-modified-since'] = previous.lastModified
  }
  return headers
}

function itemMap(items: readonly WatchedItem[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.key, item.fingerprint]))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PageOutcome {
  readonly state: PageState
  readonly changes: readonly DiscoveredChange[]
}

/** `covers` da mudança: o do item (padrão do índice) ou o da página; omitido se vazio. */
function coversField(
  page: WatchPage,
  item?: { readonly covers?: readonly string[] | null },
): Pick<DiscoveredChange, 'covers'> {
  const covers = item?.covers ?? page.covers ?? []
  return covers.length === 0 ? {} : { covers: [...covers] }
}

function change(
  page: WatchPage,
  kind: DiscoveredKind,
  fields: Pick<DiscoveredChange, 'sourceUrl' | 'effectiveFrom' | 'versionLabel'>,
  item?: { readonly covers?: readonly string[] | null },
): DiscoveredChange {
  return {
    family: page.family,
    kind,
    pageId: page.id,
    mode: page.mode,
    status: 'new',
    ...fields,
    ...coversField(page, item),
  }
}

/** Mudanças de uma página já observada antes (com a mesma URL). */
function diffSignals(
  page: WatchPage,
  url: string,
  previous: PageState,
  signals: PageSignals,
  runDate: IsoDate,
): { changes: DiscoveredChange[]; newPending: PendingAct[] } {
  const changes: DiscoveredChange[] = []
  const newPending: PendingAct[] = []
  if (page.kind === WatchKind.Consolidated) {
    if (signals.label !== previous.label) {
      changes.push(
        change(page, DiscoveredKind.Consolidated, {
          sourceUrl: url,
          effectiveFrom: signals.labelDate ?? runDate,
          versionLabel: signals.label,
        }),
      )
    }
    return { changes, newPending }
  }
  for (const item of signals.items) {
    const before = previous.items[item.key]
    const isNew = before === undefined
    const isChangedTable = page.kind === WatchKind.TablesWs && !isNew && before !== item.fingerprint
    if (!isNew && !isChangedTable) {
      continue
    }
    const fields = {
      sourceUrl: item.url,
      effectiveFrom: item.date ?? runDate,
      versionLabel: item.versionLabel,
    }
    if (page.kind === WatchKind.ActList) {
      changes.push(change(page, DiscoveredKind.Act, fields))
      if (item.actNumber !== null) {
        newPending.push({
          family: page.family,
          number: item.actNumber,
          versionLabel: item.versionLabel,
          effectiveFrom: fields.effectiveFrom,
          sourceUrl: item.url,
          detectedOn: runDate,
        })
      }
    } else if (page.kind === WatchKind.DocumentIndex) {
      changes.push(change(page, DiscoveredKind.Document, fields, item))
    } else {
      changes.push(change(page, DiscoveredKind.Table, fields))
    }
  }
  return { changes, newPending }
}

async function observePage(
  deps: WatchSourcesDeps,
  page: WatchPage,
  previous: PageState | undefined,
  runDate: IsoDate,
): Promise<PageOutcome> {
  const url = resolvePageUrl(page.url, runDate)
  const response = await deps.fetcher.fetch({
    url,
    method: 'GET',
    headers: conditionalHeaders(previous, url),
  })
  const sameUrl = previous !== undefined && previous.url === url
  if (response.status === 304 && sameUrl) {
    return { state: { ...previous, checkedOn: runDate }, changes: [] }
  }
  let signals: PageSignals
  if (response.status === 404 && isTemplated(page)) {
    signals = { label: null, labelDate: null, labelNumber: null, items: [] }
  } else if (response.status === 200) {
    signals = deps.reader.read(page, { url: response.url, body: response.body })
  } else {
    throw new WatchStateError(`HTTP ${String(response.status)} em ${url}`)
  }
  const validators: Readonly<Record<string, string>> =
    response.status === 200 ? response.headers : {}
  const { etag = null, 'last-modified': lastModified = null } = validators
  const fresh: PageState = {
    url,
    etag,
    lastModified,
    checkedOn: runDate,
    label: signals.label,
    labelNumber: signals.labelNumber,
    items: itemMap(signals.items),
    pending: [],
  }
  if (!sameUrl) {
    // Linha de base: nada a reportar na primeira observação desta URL. Pendentes de outra URL
    // da mesma página (ex.: sumário do ano anterior) continuam valendo.
    return { state: { ...fresh, pending: previous?.pending ?? [] }, changes: [] }
  }
  const { changes, newPending } = diffSignals(page, url, previous, signals, runDate)
  return { state: { ...fresh, pending: [...previous.pending, ...newPending] }, changes }
}

/** Maior número de ato já consolidado por família (dos rótulos das páginas `consolidated`). */
function consolidatedNumbers(pages: readonly WatchPage[], state: WatchState): Map<Family, number> {
  const numbers = new Map<Family, number>()
  for (const page of pages) {
    const labelNumber = state.pages[page.id]?.labelNumber ?? null
    if (page.kind !== WatchKind.Consolidated || labelNumber === null) {
      continue
    }
    numbers.set(page.family, Math.max(numbers.get(page.family) ?? labelNumber, labelNumber))
  }
  return numbers
}

/**
 * Remove os pendentes já alcançados pelo consolidado e reapresenta os demais (que não foram
 * detectados neste run) como `pending`.
 */
function settlePending(
  pages: readonly WatchPage[],
  state: WatchState,
  newChanges: readonly DiscoveredChange[],
): DiscoveredChange[] {
  const numbers = consolidatedNumbers(pages, state)
  const reported: DiscoveredChange[] = []
  const newKeys = new Set(newChanges.map((item) => `${item.pageId}|${item.sourceUrl}`))
  for (const page of pages) {
    const pageState = state.pages[page.id]
    if (page.kind !== WatchKind.ActList || pageState === undefined) {
      continue
    }
    const consolidated = numbers.get(page.family)
    const open = pageState.pending.filter(
      (act) => consolidated === undefined || act.number > consolidated,
    )
    state.pages[page.id] = { ...pageState, pending: open }
    for (const act of open) {
      if (newKeys.has(`${page.id}|${act.sourceUrl}`)) {
        continue
      }
      reported.push({
        family: page.family,
        sourceUrl: act.sourceUrl,
        effectiveFrom: act.effectiveFrom,
        versionLabel: act.versionLabel,
        kind: DiscoveredKind.Act,
        pageId: page.id,
        mode: page.mode,
        status: 'pending',
        ...coversField(page),
      })
    }
  }
  return reported
}

/**
 * Atos detectados e já consolidados no mesmo run não abrem lacuna: o consolidado novo já é a
 * mudança (e ele dispara a ingestão).
 */
function dropConsolidatedActs(
  pages: readonly WatchPage[],
  state: WatchState,
  changes: readonly DiscoveredChange[],
): DiscoveredChange[] {
  const stillPending = new Set<string>()
  for (const page of pages) {
    for (const act of state.pages[page.id]?.pending ?? []) {
      stillPending.add(`${page.id}|${act.sourceUrl}`)
    }
  }
  return changes.filter(
    (item) =>
      item.kind !== DiscoveredKind.Act || stillPending.has(`${item.pageId}|${item.sourceUrl}`),
  )
}

export async function watchSources(
  deps: WatchSourcesDeps,
  command: WatchSourcesCommand,
): Promise<DiscoveredReport> {
  const now = deps.clock.now()
  const runDate = isoDateInTimeZone(now)
  const state = await loadState(deps.blobs)
  const changes: DiscoveredChange[] = []
  const errors: WatchPageError[] = []
  for (const page of command.pages) {
    try {
      const outcome = await observePage(deps, page, state.pages[page.id], runDate)
      state.pages[page.id] = outcome.state
      changes.push(...outcome.changes)
    } catch (error) {
      errors.push({ pageId: page.id, family: page.family, message: errorMessage(error) })
    }
  }
  const pending = settlePending(command.pages, state, changes)
  const all = [...dropConsolidatedActs(command.pages, state, changes), ...pending]
  const unverifiedFamilies = [...new Set(errors.map((item) => item.family))].sort(compareCodeUnits)
  const report: DiscoveredReport = {
    schemaVersion: 1,
    runDate,
    generatedAt: now.toISOString(),
    changes: all,
    errors,
    unverifiedFamilies,
  }
  if (command.dryRun !== true) {
    await deps.blobs.set(
      BlobStoreName.CorpusManifests,
      WATCH_STATE_KEY,
      `${JSON.stringify(state, null, 2)}\n`,
    )
    const json = `${JSON.stringify(report, null, 2)}\n`
    await deps.blobs.set(BlobStoreName.CorpusManifests, DISCOVERED_KEY, json)
    await deps.blobs.set(BlobStoreName.CorpusManifests, `discovered/${runDate}.json`, json)
  }
  return report
}
