/**
 * `corpus.embedding_cache`: o checkpoint dos embeddings da ingestão. A chave é o hash do texto de
 * embedding (`embeddingText(heading_path, conteúdo)`, `ContentHasher`) e o modelo. Cada lote
 * embutido é gravado (commit próprio) antes do próximo, então um run interrompido pelo orçamento
 * retoma de onde parou sem pagar de novo.
 */
export interface EmbeddingCache {
  /** Vetores já gravados, por hash (só os encontrados). */
  getMany(hashes: readonly string[], model: string): Promise<ReadonlyMap<string, number[]>>
  /** Grava (ou mantém, se já existir) os vetores de um lote. */
  putMany(
    entries: readonly { readonly hash: string; readonly vector: readonly number[] }[],
    model: string,
  ): Promise<void>
  /** Apaga as entradas do modelo cujo hash não está em `keep`; devolve quantas apagou. */
  retainOnly(model: string, keep: ReadonlySet<string>): Promise<number>
}
