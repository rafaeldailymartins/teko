import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import type { ReferenceInput } from '@teko/shared/vigencia'
import type {
  GetCoverageResponse,
  GetMeResponse,
  GetProvisionDiffResponse,
  GetProvisionTimelineResponse,
  GetQuestionResponse,
  GetQuotaResponse,
  ListConversationsResponse,
  ListHistoryResponse,
  SearchProvisionsResponse,
} from './__generated__/types.gen.ts'
import type { ApiError } from './errors.ts'
import {
  conversationsQuery,
  coverageQuery,
  historyQuery,
  meQuery,
  provisionDiffQuery,
  provisionSearchQuery,
  provisionTimelineQuery,
  questionQuery,
  quotaQuery,
} from './queries.ts'

/**
 * Hooks de leitura da API para a UI: um `useQuery` sobre cada option de `queries.ts`. O erro é
 * sempre `ApiError` (a UI mostra `t(error.messageKey)`); parâmetro `null` deixa a consulta parada.
 */

type ApiQuery<T> = UseQueryResult<T, ApiError>

export function useMe(): ApiQuery<GetMeResponse> {
  return useQuery(meQuery())
}

export function useCoverage(): ApiQuery<GetCoverageResponse> {
  return useQuery(coverageQuery())
}

/** Cota do dia; só consulta quando `enabled` (o composer bloqueado mostra o reset). */
export function useQuota(enabled: boolean): ApiQuery<GetQuotaResponse> {
  return useQuery(quotaQuery(enabled))
}

/** Perguntas de uma conversa. */
export function useHistory(conversationId: string | null): ApiQuery<ListHistoryResponse> {
  return useQuery(historyQuery(conversationId))
}

/** Conversas do usuário, página a página (`fetchNextPage` enquanto `hasNextPage`). */
export function useConversations(): UseInfiniteQueryResult<
  InfiniteData<ListConversationsResponse, unknown>,
  ApiError
> {
  return useInfiniteQuery(conversationsQuery())
}

export function useQuestion(id: string | null): ApiQuery<GetQuestionResponse> {
  return useQuery(questionQuery(id))
}

export function useProvisionTimeline(
  stableKey: string | null,
): ApiQuery<GetProvisionTimelineResponse> {
  return useQuery(provisionTimelineQuery(stableKey))
}

export function useProvisionDiff(
  stableKey: string | null,
  from: ReferenceInput,
  to: ReferenceInput,
): ApiQuery<GetProvisionDiffResponse> {
  return useQuery(provisionDiffQuery(stableKey, from, to))
}

export function useProvisionSearch(
  q: string,
  reference: ReferenceInput,
): ApiQuery<SearchProvisionsResponse> {
  return useQuery(provisionSearchQuery(q, reference))
}
