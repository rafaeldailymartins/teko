/**
 * `corpus.embedding_cache`: o checkpoint dos embeddings da ingestão. A chave é o hash do texto de
 * embedding (`embeddingText(heading_path, conteúdo)`, `ContentHasher`) e o modelo. Cada lote
 * embutido é gravado (commit próprio) antes do próximo, então um run interrompido pelo orçamento
 * retoma de onde parou sem pagar de novo.
 *
 * Nenhuma operação traz vetor do banco para a aplicação: o vetor só entra (`putMany`) e é copiado
 * para `corpus.chunks` dentro do próprio banco (`IngestionUnitOfWork.insertVersions`). Ler vetores
 * em texto custa ~12,7 KB por chunk de transferência pública do Neon (cota de 5 GB/mês no Free).
 */
export interface EmbeddingCache {
  /** Hashes que já têm vetor gravado para o modelo (só os encontrados, sem os vetores). */
  cachedHashes(hashes: readonly string[], model: string): Promise<ReadonlySet<string>>
  /** Grava (ou mantém, se já existir) os vetores de um lote. */
  putMany(
    entries: readonly { readonly hash: string; readonly vector: readonly number[] }[],
    model: string,
  ): Promise<void>
  /** Apaga as entradas do modelo cujo hash não está em `keep`; devolve quantas apagou. */
  retainOnly(model: string, keep: ReadonlySet<string>): Promise<number>
}
