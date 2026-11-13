/**
 * Artefatos da ingestão (ADR 0030). Nunca guarda dado de usuário: só fontes baixadas, saídas do
 * Docling, estado do watch, snapshots do corpus e artefatos de eval. Adapters: GitHub Releases do
 * repositório (`BLOB_STORE=github-releases`) e em memória (testes e execução local sem
 * credenciais).
 *
 * Chaves dos artefatos de fonte: `{family}/{docSlug}/{versionLabel}/{sha256}.{pdf|htm|txt|json}`.
 */

export const BlobStoreName = {
  /** Arquivos-fonte como baixados. */
  CorpusRaw: 'corpus-raw',
  /** `docling.json` de cada PDF/XLSX (saída do `tools/ingest`). */
  CorpusDocling: 'corpus-docling',
  /** Estado do `sources-watch` (`watch-state.json`) e `discovered.json`. */
  CorpusManifests: 'corpus-manifests',
  /** `snapshots/<corpusVersion>/{manifest.json, <tabela>.jsonl.zst}`; retenção das 3 últimas. */
  CorpusSnapshots: 'corpus-snapshots',
  EvalArtifacts: 'eval-artifacts',
} as const
export type BlobStoreName = (typeof BlobStoreName)[keyof typeof BlobStoreName]

export interface BlobStore {
  /** Conteúdo da chave, ou `null` se não existir. */
  get(store: BlobStoreName, key: string): Promise<Uint8Array | null>
  /** Grava (sobrescreve) a chave. */
  set(store: BlobStoreName, key: string, data: Uint8Array | string): Promise<void>
  /** Chaves com o prefixo, em ordem lexicográfica. */
  list(store: BlobStoreName, prefix?: string): Promise<string[]>
  delete(store: BlobStoreName, key: string): Promise<void>
}
