import type { ResolvedRequestOptions } from './__generated__/client/index.ts'
import { client } from './__generated__/client.gen.ts'
import { toApiError } from './errors.ts'
import { withTraceparent } from './trace.ts'

/**
 * Instância única do cliente gerado (`baseUrl: '/api'`, mesma origem; o `fetch` manda o cookie de
 * sessão por padrão, `credentials: 'same-origin'`). Dois interceptors:
 *
 * - de requisição: um `traceparent` W3C novo por chamada (`trace.ts`), para a API ligar a chamada
 *   ao trace dela e devolver o mesmo `trace_id` em `x-trace-id`;
 * - de erro: troca o corpo cru que o cliente lança (problem+json, texto ou a exceção do `fetch`)
 *   por um `ApiError` tipado, com o "ID de suporte", para os hooks e a UI tratarem um formato só.
 *
 * Os hooks passam `client: apiClient` explicitamente: o import garante os interceptors registrados
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

function traceparentInterceptor(request: Request, _options: ResolvedRequestOptions): Request {
  withTraceparent(request.headers)
  return request
}

if (!client.interceptors.request.exists(traceparentInterceptor)) {
  client.interceptors.request.use(traceparentInterceptor)
}
if (!client.interceptors.error.exists(apiErrorInterceptor)) {
  client.interceptors.error.use(apiErrorInterceptor)
}

export const apiClient = client
