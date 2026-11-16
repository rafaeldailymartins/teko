import { isAnalyticsEventName } from '@teko/shared/analytics'
import type {
  BeforeSendFn,
  CaptureResult,
  PostHogConfig,
  Properties,
} from 'posthog-js/dist/module.no-external'
import { POSTHOG_API_HOST } from './posthog-hosts.ts'

/**
 * Configuração do `posthog-js` e os filtros que rodam antes de cada envio. Só o `posthog-client.ts`
 * importa este módulo, e ele só entra por `import()` depois do consentimento.
 */

/**
 * Eventos do próprio SDK que podem sair, além do catálogo de `@teko/shared/analytics`: os das
 * pesquisas in-app (categoria `surveys`). Todo o resto (`$pageview`, `$autocapture`,
 * `$feature_flag_called`...) é descartado no `before_send`.
 */
export const SDK_EVENTS: ReadonlySet<string> = new Set([
  'survey shown',
  'survey sent',
  'survey dismissed',
])

/** O evento pode sair: está no catálogo tipado ou é um evento permitido do SDK. */
export function isAllowedEvent(name: string): boolean {
  return isAnalyticsEventName(name) || SDK_EVENTS.has(name)
}

/**
 * URL sem query nem âncora (`https://host/pt-BR/chat/`): a query do app leva identificadores de
 * conversa e de pergunta (`c`, `q`), e a de outro site pode levar o que for. Texto que não é URL
 * http(s) fica como está.
 */
export function stripUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) {
    return value
  }
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value
  }
}

function sanitizeProperties(properties: Properties): Properties {
  const sanitized: Properties = {}
  for (const [key, value] of Object.entries(properties)) {
    sanitized[key] = typeof value === 'string' ? stripUrl(value) : value
  }
  return sanitized
}

/**
 * Filtro final do SDK: nada sai com o analytics desligado (consentimento retirado nesta página),
 * evento fora da lista é descartado e toda URL das propriedades perde query e âncora.
 */
export function createBeforeSend(isActive: () => boolean): BeforeSendFn {
  return (event: CaptureResult | null) => {
    if (event === null || !isActive() || !isAllowedEvent(event.event)) {
      return null
    }
    const sanitized: CaptureResult = { ...event, properties: sanitizeProperties(event.properties) }
    if (event.$set !== undefined) {
      sanitized.$set = sanitizeProperties(event.$set)
    }
    if (event.$set_once !== undefined) {
      sanitized.$set_once = sanitizeProperties(event.$set_once)
    }
    return sanitized
  }
}

export interface PosthogConfigOptions {
  /** Pesquisas permitidas na escolha atual. */
  readonly surveys: boolean
  readonly beforeSend: BeforeSendFn
}

/**
 * Configuração do `init` (`docs/architecture/frontend.md`, "Analytics e consentimento"):
 *
 * - EU direto, sem baixar script externo (`disable_external_dependency_loading`): o que o SDK usa
 *   vem no chunk, inclusive as pesquisas;
 * - `cookieless_mode: 'on_reject'`: depois de um opt-out o SDK não grava nada no navegador;
 * - `persistence: 'localStorage'`: com o aceite, o identificador anônimo fica no `localStorage`, sem
 *   cookie;
 * - `person_profiles: 'identified_only'` e nenhum `identify`: os eventos não se ligam à conta;
 * - só o catálogo tipado sai: sem autocapture (o texto de um botão ou de um item do histórico pode
 *   ser a pergunta), sem pageview, pageleave, heatmap, dead click e web vitals do SDK (o
 *   `web_vital` do catálogo vem do `useReportWebVitals`), sem replay, sem exceções (a
 *   `add-error-tracking` liga) e sem experimentos, tours e chat.
 */
export function posthogConfig({
  surveys,
  beforeSend,
}: PosthogConfigOptions): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_API_HOST,
    defaults: '2026-08-30',
    disable_external_dependency_loading: true,
    cookieless_mode: 'on_reject',
    persistence: 'localStorage',
    cross_subdomain_cookie: false,
    person_profiles: 'identified_only',
    internal_or_test_user_hostname: null,
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_surveys: !surveys,
    save_campaign_params: false,
    mask_personal_data_properties: true,
    before_send: beforeSend,
  }
}

/**
 * Chaves que o PostHog grava no navegador: as do SDK (`ph_<chave>_posthog`, `__ph_opt_in_out_…`) e
 * as das pesquisas (`seenSurvey_…`, `inProgressSurvey_…`, `abandonedSurvey_…`,
 * `lastSeenSurveyDate`).
 */
const POSTHOG_KEY =
  /^(?:__)?ph_|posthog|^(?:seen|inProgress|abandoned)Survey_|^lastSeenSurveyDate$/i

/** O pedaço do `window` que a limpeza usa (o teste passa um falso). */
export interface BrowserStorageTarget {
  readonly localStorage: Storage
  readonly sessionStorage: Storage
  readonly document: Pick<Document, 'cookie'>
}

function clearStorage(storage: Storage): void {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null && POSTHOG_KEY.test(key)) {
      keys.push(key)
    }
  }
  for (const key of keys) {
    storage.removeItem(key)
  }
}

/**
 * Apaga do navegador tudo o que é do PostHog (consentimento retirado). Storage bloqueado não
 * derruba a página: o que não deu para ler também não foi gravado.
 */
export function clearPosthogStorage(target: BrowserStorageTarget): void {
  for (const read of [() => target.localStorage, () => target.sessionStorage]) {
    try {
      clearStorage(read())
    } catch {
      // Storage bloqueado.
    }
  }
  const cookieNames = target.document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0]?.trim() ?? '')
    .filter((name) => POSTHOG_KEY.test(name))
  for (const name of cookieNames) {
    target.document.cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`
  }
}
