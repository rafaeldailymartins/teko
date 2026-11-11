/**
 * `content_hash` = sha256 hexadecimal do texto normalizado (`normalizeForHash`). Chave do
 * `embedding_cache`, da fixture de embeddings e do merge de versões idênticas.
 */
export interface ContentHasher {
  hash(text: string): string
}
