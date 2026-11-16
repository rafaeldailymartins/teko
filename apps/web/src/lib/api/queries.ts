import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  skipToken,
  type UseQueryOptions,
} from '@tanstack/react-query'
import type { ReferenceInput } from '@teko/shared/vigencia'
import {
  getAuthProvidersOptions,
  getCoverageOptions,
  getMeOptions,
  getProvisionDiffOptions,
  getProvisionTimelineOptions,
  getQuestionOptions,
  getQuotaOptions,
  listConversationsInfiniteOptions,
  listHistoryOptions,
  searchProvisionsOptions,
} from './__generated__/@tanstack/react-query.gen.ts'
import type { ListConversationsResponse } from './__generated__/types.gen.ts'
import { listPasskeys } from './auth.ts'
import { apiClient } from './client.ts'
import type { ApiError } from './errors.ts'
import { referenceKeyDate } from './reference.ts'

/**
 * Options de consulta sobre as geradas (`@tanstack/react-query.gen.ts`), usadas pelos hooks e por
 * quem precisa da key (invalidar, pré-carregar, `setQueryData`). Todas passam o `apiClient` (com o
 * interceptor que lança `ApiError`) e desligam a consulta enquanto falta parâmetro (`skipToken`).
 *
 * As query keys são as geradas, que já incluem `path` e `query`. Quando a resposta depende da data
 * de referência, a data efetiva vai explícita na query (`at`, `from`, `to`), e com ela na key:
 * `2024-03` e `2024-03-01` dividem o cache; outra data é outra entrada.
 */

type ApiQueryOptions<TData, TKey extends QueryKey> = UseQueryOptions<TData, ApiError, TData, TKey>

interface GeneratedQuery<TData, TKey extends QueryKey> {
  readonly queryKey: TKey
  readonly queryFn?: QueryFunction<TData, TKey, never> | typeof skipToken
}

/** Key e função das options geradas; `enabled: false` vira `skipToken` (tipado, sem `enabled`). */
function apiQuery<TData, TKey extends QueryKey>(
  { queryKey, queryFn }: GeneratedQuery<TData, TKey>,
  enabled = true,
): ApiQueryOptions<TData, TKey> {
  return { queryKey, queryFn: enabled && queryFn !== undefined ? queryFn : skipToken }
}

/** Usuário da sessão e onboarding (`GET /v1/me`); `unauthenticated` quando não há sessão. */
export function meQuery() {
  return apiQuery(getMeOptions({ client: apiClient }))
}

/** Cota de perguntas do dia (`GET /v1/me/quota`); `false` = desligada (sem sessão). */
export function quotaQuery(enabled = true) {
  return apiQuery(getQuotaOptions({ client: apiClient }), enabled)
}

/** Passkeys da conta (`GET /auth/passkey/list-user-passkeys`, fora do OpenAPI). */
export function passkeysQuery(enabled = true) {
  return apiQuery({ queryKey: ['auth', 'passkeys'] as const, queryFn: listPasskeys }, enabled)
}

/**
 * Métodos de entrada ativos no ambiente (`GET /v1/auth/providers`, pública). É configuração do
 * deploy: não fica velha durante a visita.
 */
export function authProvidersQuery() {
  return {
    ...apiQuery(getAuthProvidersOptions({ client: apiClient })),
    staleTime: Number.POSITIVE_INFINITY,
  }
}

/** Cobertura efetiva do corpus por família (`GET /v1/coverage`, pública). */
export function coverageQuery() {
  return apiQuery(getCoverageOptions({ client: apiClient }))
}

/** Perguntas de uma conversa (`GET /v1/questions?conversationId=`); `null` = desligada. */
export function historyQuery(conversationId: string | null) {
  return apiQuery(
    listHistoryOptions({ client: apiClient, query: { conversationId: conversationId ?? '' } }),
    conversationId !== null,
  )
}

/** Página da lista de conversas: sem cursor, a primeira (`{}` = nenhum parâmetro a mais). */
type ConversationPageParam = string | Record<string, never>

/**
 * Lista de conversas (`GET /v1/conversations`), infinita por cursor: cada página traz o
 * `nextCursor` da seguinte, e `null` encerra (`hasNextPage: false`).
 */
export function conversationsQuery() {
  const { queryKey, queryFn } = listConversationsInfiniteOptions({ client: apiClient })
  return infiniteQueryOptions<
    ListConversationsResponse,
    ApiError,
    InfiniteData<ListConversationsResponse, ConversationPageParam>,
    typeof queryKey,
    ConversationPageParam
  >({
    queryKey,
    queryFn: queryFn as QueryFunction<
      ListConversationsResponse,
      typeof queryKey,
      ConversationPageParam
    >,
    initialPageParam: {},
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

/**
 * Depois de cada pergunta (respondida, recusada, com erro ou parada: a API já a gravou), a lista
 * de conversas ganha a conversa nova ou sobe a atual, e a cota do dia muda. Sem isso, o painel de
 * histórico só mostraria a pergunta depois de recarregar a página.
 */
export async function refreshAfterQuestion(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: conversationsQuery().queryKey }),
    client.invalidateQueries({ queryKey: quotaQuery().queryKey }),
  ])
}

/** Uma pergunta com a resposta ou a recusa (`GET /v1/questions/:id`); `null` = desligada. */
export function questionQuery(id: string | null) {
  return apiQuery(getQuestionOptions({ client: apiClient, path: { id: id ?? '' } }), id !== null)
}

/** Redações do dispositivo ao longo do tempo (`GET /v1/provisions/:stableKey/timeline`). */
export function provisionTimelineQuery(stableKey: string | null) {
  return apiQuery(
    getProvisionTimelineOptions({ client: apiClient, path: { stableKey: stableKey ?? '' } }),
    stableKey !== null,
  )
}

/** "O que mudou" entre as redações vigentes em duas referências (lazy: `null` = desligada). */
export function provisionDiffQuery(
  stableKey: string | null,
  from: ReferenceInput,
  to: ReferenceInput,
) {
  return apiQuery(
    getProvisionDiffOptions({
      client: apiClient,
      path: { stableKey: stableKey ?? '' },
      query: { from: referenceKeyDate(from), to: referenceKeyDate(to) },
    }),
    stableKey !== null,
  )
}

/** Mínimo de caracteres da busca da paleta (o mesmo do schema da API). */
const PROVISION_QUERY_MIN_LENGTH = 2

/**
 * Busca da paleta (`GET /v1/provisions?q=&at=`). A data efetiva da referência vai sempre em `at`:
 * sem ela, a API usaria "hoje" e a key não mudaria com a data escolhida.
 */
export function provisionSearchQuery(q: string, reference: ReferenceInput) {
  const text = q.trim()
  return apiQuery(
    searchProvisionsOptions({
      client: apiClient,
      query: { q: text, at: referenceKeyDate(reference) },
    }),
    text.length >= PROVISION_QUERY_MIN_LENGTH,
  )
}
