import type { OnboardingRequest } from '@teko/shared/contracts'
import { completeOnboarding, deleteMyData, exportMyData } from './__generated__/sdk.gen.ts'
import type { CompleteOnboardingResponse, ExportMyDataResponse } from './__generated__/types.gen.ts'
import { apiClient } from './client.ts'

/**
 * Conta e direitos do titular (`/api/v1/me*`) pelo SDK gerado. As leituras ficam em `queries.ts`;
 * aqui estão as mutações e a exportação, que é um download e não entra no cache.
 */

/** Conclui o onboarding (18+, versão vigente dos Termos e país); devolve o `/me` atualizado. */
export async function submitOnboarding(
  body: OnboardingRequest,
): Promise<CompleteOnboardingResponse> {
  const { data } = await completeOnboarding({ client: apiClient, body, throwOnError: true })
  return data
}

/** Nome do anexo quando a resposta não traz um `Content-Disposition` legível. */
export const EXPORT_FILENAME = 'teko-meus-dados.json'

/** `filename="…"` do `Content-Disposition`, só com caracteres seguros para um nome de arquivo. */
export function attachmentFilename(header: string | null): string {
  const match = header?.match(/filename="([\w.-]{1,100})"/)
  return match?.[1] ?? EXPORT_FILENAME
}

export interface MyDataExport {
  readonly filename: string
  readonly data: ExportMyDataResponse
}

/** Exportação LGPD (`GET /v1/me/export`, lida do banco pela API), pronta para virar arquivo. */
export async function fetchMyDataExport(): Promise<MyDataExport> {
  const { data, response } = await exportMyData({ client: apiClient, throwOnError: true })
  return { filename: attachmentFilename(response.headers.get('content-disposition')), data }
}

/** Apaga a conta e tudo o que é dela (`DELETE /v1/me`); a resposta já apaga o cookie. */
export async function deleteAccount(): Promise<void> {
  await deleteMyData({ client: apiClient, throwOnError: true })
}
