import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { OnboardingRequest } from '@teko/shared/contracts'
import type { ReferenceInput } from '@teko/shared/vigencia'
import type {
  GetCoverageResponse,
  GetMeResponse,
  GetProvisionDiffResponse,
  GetProvisionTimelineResponse,
  GetQuestionResponse,
  GetQuotaResponse,
  ListHistoryResponse,
  SearchProvisionsResponse,
} from './__generated__/types.gen.ts'
import { deleteAccount, fetchMyDataExport, type MyDataExport, submitOnboarding } from './account.ts'
import { deletePasskey, type Passkey, registerPasskey, signOut } from './auth.ts'
import type { ApiError } from './errors.ts'
import {
  coverageQuery,
  historyQuery,
  meQuery,
  passkeysQuery,
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

/** Cota do dia; `enabled: false` enquanto não há sessão. */
export function useQuota(enabled = true): ApiQuery<GetQuotaResponse> {
  return useQuery(quotaQuery(enabled))
}

/** Passkeys da conta; `enabled: false` enquanto não há sessão. */
export function usePasskeys(enabled = true): ApiQuery<Passkey[]> {
  return useQuery(passkeysQuery(enabled))
}

export function useCoverage(): ApiQuery<GetCoverageResponse> {
  return useQuery(coverageQuery())
}

/** Histórico de uma conversa (a API lista por conversa; não há lista de conversas). */
export function useHistory(conversationId: string | null): ApiQuery<ListHistoryResponse> {
  return useQuery(historyQuery(conversationId))
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

/**
 * Mutações da conta. O erro é `ApiError` (ou `PasskeyError`, na cerimônia da passkey). Sair e
 * excluir a conta não mexem no cache: quem chama recarrega a página no destino, o que zera tudo.
 */
type ApiMutation<TData, TVariables = void> = UseMutationResult<TData, Error, TVariables>

/** Onboarding: grava no cache o `/me` que a API devolve, e a guarda libera o app na hora. */
export function useCompleteOnboarding(): ApiMutation<GetMeResponse, OnboardingRequest> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitOnboarding,
    onSuccess: (me) => queryClient.setQueryData(meQuery().queryKey, me),
  })
}

export function useSignOut(): ApiMutation<void> {
  return useMutation({ mutationFn: signOut })
}

export function useDeleteAccount(): ApiMutation<void> {
  return useMutation({ mutationFn: deleteAccount })
}

export function useExportMyData(): ApiMutation<MyDataExport> {
  return useMutation({ mutationFn: fetchMyDataExport })
}

/** Cadastro e remoção de passkey; os dois relêem a lista. */
export function useRegisterPasskey(): ApiMutation<void, string | undefined> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: registerPasskey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeysQuery().queryKey }),
  })
}

export function useDeletePasskey(): ApiMutation<void, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deletePasskey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeysQuery().queryKey }),
  })
}
