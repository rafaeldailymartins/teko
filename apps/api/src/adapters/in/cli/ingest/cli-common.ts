import { createHash } from 'node:crypto'

/**
 * Peças comuns dos subcomandos `ingest discover`, `ingest load` e `eval-fixture export`: códigos
 * de saída (sysexits), erro de uso e sha256.
 */

export const EXIT_OK = 0
export const EXIT_FAILURE = 1
/** Uso incorreto (`EX_USAGE`). */
export const EXIT_USAGE = 64
/**
 * Falha temporária (`EX_TEMPFAIL`): o orçamento diário de neurons acabou. O `ingest.yml` trata
 * como "retomar amanhã" (o próximo run continua pelo `embedding_cache`), não como falha vermelha.
 */
export const EXIT_BUDGET_EXHAUSTED = 75

export const IngestTarget = {
  Staging: 'staging',
  Production: 'production',
} as const
export type IngestTarget = (typeof IngestTarget)[keyof typeof IngestTarget]

export function isIngestTarget(value: unknown): value is IngestTarget {
  return value === IngestTarget.Staging || value === IngestTarget.Production
}

export class CliUsageError extends Error {
  readonly exitCode = EXIT_USAGE

  constructor(message: string, usage: string) {
    super(`${message}\n${usage}`)
    this.name = 'CliUsageError'
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Mensagem de um erro desconhecido, sem pilha (vai para o relatório e para o log). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
