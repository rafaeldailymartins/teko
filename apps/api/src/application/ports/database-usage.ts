/**
 * Medidas e manutenção do banco usadas pela ingestão (URL do owner):
 * - `DatabaseUsage`: tamanho do banco (`pg_database_size`), para a guarda de 800 MB (o limite do
 *   Neon Free é 1 GB, e o staging deve ficar em ≤ 400 MB);
 * - `VectorIndexMaintenance`: `--bulk` (só staging) derruba o HNSW antes da carga e o recria no
 *   fim, com `maintenance_work_mem='512MB'`;
 * - `ComputeUsageMeter`: CU-segundos acumulados do projeto Neon no período de cobrança (API v2,
 *   `GET /projects/{id}`, `compute_time_seconds`). Opcional: sem credenciais, `null`.
 */

export interface DatabaseUsage {
  sizeBytes(): Promise<number>
}

export interface VectorIndexMaintenance {
  /** Remove o índice HNSW de `corpus.chunks` (no-op se já não existir). */
  dropVectorIndex(): Promise<void>
  /** Cria o HNSW se faltar (no-op se existir), com `maintenance_work_mem` alto. */
  ensureVectorIndex(): Promise<void>
}

export interface ComputeUsageMeter {
  /** CU-segundos do período de cobrança atual, ou `null` se a medição não estiver disponível. */
  computeSeconds(): Promise<number | null>
}

/** Projeção da guarda prospectiva: os chunks novos da versão, ao tamanho médio medido. */
interface SizeProjection {
  readonly currentBytes: number
  readonly newChunks: number
  readonly bytesPerChunk: number
}

export class DatabaseSizeLimitError extends Error {
  readonly sizeBytes: number
  readonly limitBytes: number
  readonly projection: SizeProjection | null

  constructor(sizeBytes: number, limitBytes: number, projection: SizeProjection | null = null) {
    super(
      projection === null
        ? `banco com ${String(sizeBytes)} bytes, acima do limite de ${String(limitBytes)} bytes: ingestão abortada`
        : `banco com ${String(projection.currentBytes)} bytes + ${String(projection.newChunks)} chunks novos × ` +
            `${String(projection.bytesPerChunk)} bytes = ${String(sizeBytes)} bytes, acima do limite de ` +
            `${String(limitBytes)} bytes: ingestão abortada antes dos embeddings`,
    )
    this.name = 'DatabaseSizeLimitError'
    this.sizeBytes = sizeBytes
    this.limitBytes = limitBytes
    this.projection = projection
  }
}
