import type { ResolvedRequestOptions } from './__generated__/client/index.ts'
import { client } from './__generated__/client.gen.ts'
import { toApiError } from './errors.ts'

/**
 * Instância única do cliente gerado (`baseUrl: '/api'`, mesma origem; o `fetch` manda o cookie de
 * sessão por padrão, `credentials: 'same-origin'`). O interceptor de erro troca o corpo cru que o
 * cliente lança (problem+json, texto ou a exceção do `fetch`) por um `ApiError` tipado, para os
 * hooks e a UI tratarem um formato só.
 *
 * Os hooks passam `client: apiClient` explicitamente: o import garante o interceptor registrado
 * antes da primeira chamada, sem depender de import com efeito colateral.
 */
function apiErrorInterceptor(
  error: unknown,
  response: Response | undefined,
  _request: Request | undefined,
  _options: ResolvedRequestOptions,
): Error {
  return toApiError(error, response)
}

if (!client.interceptors.error.exists(apiErrorInterceptor)) {
  client.interceptors.error.use(apiErrorInterceptor)
}

export const apiClient = client
