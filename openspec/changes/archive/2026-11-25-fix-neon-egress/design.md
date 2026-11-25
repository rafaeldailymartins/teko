# Design

## Context

O Neon Free dá 5 GB de transferência pública por projeto por mês. Só conta o que **sai** do banco
para os clientes (o que a aplicação grava não conta), somando Postgres, Object Storage e Neon
Functions; estourar suspende o compute até o ciclo virar. O `teko-staging` passou de 5,09 GB em
2026-11-18, no ciclo iniciado em 2026-11-10. O Neon não detalha a transferência por consulta: a
API dá só o total do período (`data_transfer_bytes` do `GET /projects/{id}`). A investigação foi
pelo código, com o tamanho do vetor medido e o histórico dos runs do GitHub Actions.

Medidas:

- **Vetor em texto:** o `halfvec(1024)` do BGE-M3 tem em média **12.767 bytes** no texto do
  `halfvec_out` (1.614 vetores reais da fixture `test/fixtures/corpus/embeddings.json.gz`; 12.713
  em 500 vetores normais aleatórios num Postgres 18 com pgvector 0.8.6). O binário do
  `halfvec_send` tem 2.052 bytes; em base64 (com as quebras do `encode`), **2.772**. O
  `node-postgres` usa o protocolo em texto, então todo `SELECT embedding` custava ~12,7 KB por linha.
- **Corpus do staging:** ~21,5 mil chunks (`corpus/corpus.lock.json`, `health`), ~20 mil abertos
  com vetor.
- **Runs no ciclo (até 2026-11-19):** 31 do `ingest.yml` (13 exportaram snapshot: versões 3 a 14 e
  a reexportação da 14 pela migração nova; ~26,8 mil chunks novos somados; 26 `corpus-eval`, 10
  deles eval-only), além dos jobs do `ops.yml`, do `source-watch.yml` e dos deploys do staging.

## Estimativas por fluxo (staging, antes da correção)

Texto de chunk + título + colunas: ~1,5 KB por linha (estimado; o chunker corta em 4.800
caracteres). Redação (`provision_versions.text`): ~1,3 KB. Os bytes exatos não são medíveis sem o
Neon; a ordem de grandeza e a proporção entre os fluxos, sim.

| Fluxo (código)                                                                  | O que sai do banco por execução                                                      | Por execução | Execuções no ciclo | Total estimado |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ | ------------------ | -------------- |
| `ExportSnapshot` (`pg-snapshot-repository.ts`), no `load` com versão nova        | todas as tabelas exportáveis; `embedding::text` de ~20 mil chunks (~255 MB)          | ~330–340 MB  | 13                 | **~3,9–4,3 GB** |
| `IngestDocumentVersion` + `EmbedPending` (`pg-embedding-cache.ts`, `getMany`)    | o vetor de cada chunk novo, na transação; os já em cache de novo no `EmbedPending`   | 12,7–25 KB por chunk novo | ~26,8 mil chunks | ~0,35–0,7 GB |
| `corpus-eval` (`evals/providers/retrieval.ts`, busca da API)                      | 40 candidatos da busca + pool de 50 por caso, com conteúdo e ancestrais (~2,5 KB)    | ~20–30 MB    | 26                 | ~0,5–0,8 GB    |
| `PruneEmbeddingCache` (`openChunkTexts` + `retainOnly`)                          | título e texto de todos os chunks abertos; todos os hashes do cache                  | ~30–35 MB    | ~12                | ~0,4 GB        |
| `documentHealth`, `openReviewQueue`, `openVersionsOf`, `findDocumentVersion`      | agregados e linhas de redação sem texto                                              | < 1 MB       | 31                 | < 30 MB        |
| deploy do staging (migrações), smoke, system test                                | migrações; poucas perguntas pela API                                                 | < 1 MB       | ~25                | < 25 MB        |
| `ops.yml` (`coverage-age`, `weekly-maintenance`), `source-watch` (`mark-coverage`) | `corpus.coverage`; purge por SQL                                                     | < 100 KB     | ~50                | < 5 MB         |
| API do staging (perguntas)                                                       | evidências sem vetor (`pg-search-repository.ts`)                                     | ~100 KB por pergunta | poucas      | < 50 MB        |

Culpado principal: **a exportação do snapshot com o vetor em texto**, ~75% do gasto (certeza
média-alta: a soma das estimativas, ~5,2–6,3 GB, fica acima dos 5,09 GB medidos, então os bytes
por linha estão um pouco altos, mas nenhuma outra leitura chega perto). Depois, a ingestão que
trazia vetores para a aplicação, o `corpus-eval` e a poda.

## Estimativas depois da correção

| Fluxo                                             | Por execução                                   |
| ------------------------------------------------- | ---------------------------------------------- |
| `load` com versão nova (exportação)               | ~130 MB (vetor em binário: ~55 MB)             |
| `load` de novo antes do PR do lock (mesma versão) | ~0 (manifesto reaproveitado)                   |
| `load` sem nada novo                              | < 1 MB (sem exportação nem poda)               |
| ingestão de versões novas                         | 0 de vetores; ~64 bytes por hash conferido     |
| poda (só em run que publicou)                     | ~30 MB                                         |
| `corpus-eval`                                     | ~20–30 MB (inalterado)                         |

O ciclo de 2026-11-10 ficaria em ~2 GB com os mesmos runs; um mês normal (uma ingestão por semana
e um `corpus-eval` por PR que mexe na busca), bem abaixo de 1 GB.

## Goals / Non-Goals

**Goals:** nenhum fluxo traz o vetor em texto para fora do banco; a exportação, que é inevitável
(o snapshot vai para o GitHub Releases), lê o mínimo e não se repete para a mesma versão e
migração; medir a cota todo dia, alertar em 50% e 80% e impedir a ingestão e o `corpus-eval` de
rodarem acima de 80% sem decisão explícita.

**Non-Goals:** reduzir o `corpus-eval` (as evidências são o que ele mede); projeção da
transferência (o gasto vem em rajadas, e o estouro suspende na hora); guarda nos deploys do staging
(as migrações e o smoke leem < 1 MB); qualquer chamada ao Neon real nesta mudança.

## Decisions

- **Cópia do vetor dentro do banco.** `NewChunkRow` leva o `embeddingHash` em vez do vetor, e o
  `insertVersions` grava `embedding = (SELECT ec.embedding FROM corpus.embedding_cache ec WHERE
  content_hash = … AND model = …)` (um `sql` como valor do insert, aceito pelo Drizzle). O caso de
  uso confere antes, só pelas chaves (`cachedHashes`), e mantém o `ReconciliationError` de "vetor
  ausente do cache"; o repositório confere de novo depois do insert (`embedding IS NULL` nas
  redações novas → `CorpusInvariantError`, a transação volta), porque a coluna aceita nulo e um
  chunk aberto sem vetor sumiria da busca semântica sem aviso.
- **Poda no banco.** `retainOnly` vira um `DELETE … WHERE content_hash <> ALL($keep)`: a lista do
  que fica entra como parâmetro (entrada não conta) e os hashes do cache não saem mais. O texto dos
  chunks abertos continua saindo, porque o hash (`sha256(normalizeForHash(...))`, com NFC e remoção
  de invisíveis) não tem equivalente seguro em SQL; em vez disso, a poda só roda quando o run
  publicou alguma versão (um run sem nada novo não muda o que o cache precisa ter).
- **Vetor do snapshot em binário, arquivo igual.** A exportação lê `encode(halfvec_send(t.embedding),
  'base64')` e converte na aplicação para o texto `[x1,...]` com a menor forma decimal de cada
  valor que volta ao mesmo float4 (a regra do `halfvec_out`). O arquivo `.jsonl.zst`, o manifesto e
  o `promote` não mudam; o teste de integração confere, para 300 vetores reais, que o texto
  convertido é o mesmo `halfvec` do banco, e a promoção confere todos os vetores por `md5`.
  Alternativa descartada: mudar o formato do arquivo para base64 (exigiria o `promote` ler os dois
  formatos, inclusive no rollback para snapshots antigos).
- **Reaproveitar o snapshot da mesma versão e migração.** O `load` já tratava "mesma versão do
  corpus" como "mesmo conteúdo" (não exporta). A lacuna era a de dois runs seguidos com a migração
  nova antes de o PR do lock entrar (2026-11-18): cada um reexportava a versão 14. Com
  `reuseExisting`, o `ExportSnapshot` lê a versão e a migração (consultas de poucos bytes) e, se o
  manifesto delas já está no store, o devolve sem ler as tabelas. Manifesto ilegível conta como
  ausente.
- **Métrica sem projeção.** `teko_neon_data_transfer_ratio = data_transfer_bytes / 5e9` (a API manda
  dividir por 10⁹ para GB). Alertas em 0,5 (aviso) e 0,8 (crítico), no padrão do de CU-h
  (`last_over_time(...[2d])`, `noDataState: OK`).
- **Guarda como job próprio do `ingest.yml`.** `neon-transfer` roda primeiro, no environment
  `staging` (onde já estão `NEON_API_KEY_STAGING` e `NEON_STAGING_PROJECT_ID`), só com a API do
  Neon no egress; o `discover` depende dele e o `corpus-eval` exige o sucesso dele (o eval-only
  não passa pelo `discover`). Medida que falha (API fora, configuração ausente) também para: não
  saber é tratado como acima da guarda. `allow_high_transfer` libera com `::warning`.

## Risks / Trade-offs

- Os números por fluxo são estimativas; a primeira ingestão do próximo ciclo dá a medida real (o
  resumo do `ingest.yml` mostra o antes, e o painel de cotas, o depois).
- A guarda depende da API do Neon; fora do ar, a ingestão espera ou roda com
  `allow_high_transfer`.
- Um snapshot reaproveitado leva o `createdAt`, a linhagem e o `verified_at` da exportação
  anterior da mesma versão; o `promote` já fica com o maior `verified_at` e mescla as lacunas
  detectadas depois (A1).

## Fontes Context7

| Biblioteca ou serviço | ID                                    | Consultado                                                                                                                                                                                       |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Neon (docs)           | `/websites/neon`                      | 5 GB de transferência pública por projeto no Free, só saída, somando Postgres, Object Storage e Functions; estouro suspende o compute até o ciclo; `data_transfer_bytes` no `GET /projects/{id}`, total do período, dividir por 10⁹ para GB, em todos os planos |
| pgvector              | `/websites/deepwiki_pgvector_pgvector` | formato do `halfvec_send`/`halfvec_recv`: `dim` int16, `unused` int16 (0), valores half de 2 bytes em ordem de rede                                                                              |
| Drizzle ORM           | `/websites/orm_drizzle_team`          | `sql` como valor de coluna em `insert().values()`                                                                                                                                                |
