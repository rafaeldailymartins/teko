# Design

## Context

O plano fixa a escrita da ingestão ("Escrita, Blobs, snapshot e promoção"): uma transação por
versão de documento, o `embedding_cache` como checkpoint, o orçamento de 8.000 neurons/dia
(`EMBED_NEURON_BUDGET`), a guarda de 800 MB, o `--bulk` só no staging, o snapshot por tabela com
`manifest.json` e a promoção por chave natural sem recalcular embeddings. A F2 deixou o schema
(`corpus.*`), o `WriteCorpus` do seed (que continua intacto: as retrieval evals dependem dele), o
adapter Workers AI com `onUsage` e o planejador de lotes (`planEmbeddingBatches`). Os parsers
entregam um `ParsedSource` por versão de documento, com a `replacementWindow` (contrato em
`domain/corpus/parsed-source.ts`).

## Goals / Non-Goals

**Goals:**

- Reingerir a mesma versão não grava nada nem chama os embeddings; um novo download com o mesmo
  conteúdo só acrescenta fontes.
- Retomar depois do orçamento sem pagar de novo o que já foi embutido.
- Uma anomalia de vigência nunca bloqueia a publicação do documento.
- O snapshot promovido num banco vazio reproduz a busca do staging, na mesma ordem.

**Non-Goals:**

- Workflow `ingest.yml`, `source-watch` e o job `promote-corpus` (frente E; F7/F9).
- Aplicar overrides e despachar subcomandos no `cli.ts` (frente D; o orquestrador liga).
- Gravar no Neon, no Blobs ou no Workers AI reais (só depois do merge, pelo workflow).

## Decisions

- **Reconciliação pura na aplicação, operações no adapter.** `planReconciliation` (em
  `ingest-document-version.ts`) decide reaproveitar, alargar, fechar, recortar ou inserir; a porta
  `IngestionUnitOfWork` só executa. O plano é calculado duas vezes: sem trava, para saber o que
  embutir antes da transação (a chamada ao provedor nunca fica dentro dela), e de novo sobre as
  linhas travadas (`FOR UPDATE`), para gravar. Se o cache não tiver o vetor de um chunk novo na
  segunda passada, a transação falha (`ReconciliationError`).
- **Janela de substituição e recorte bitemporal** (ADR 0025). Identidade = hash do conteúdo,
  modalidade e classe de revisão (`auto`/`approved` juntas; `pending` e `rejected` cada uma
  consigo). Alarga quando `T = (E − W) ∪ P` é contíguo e contém `E`; a redação aberta que cruza a
  janela e não casou tem o `knowledge` fechado em `published_on`, e os trechos fora da janela voltam
  como linhas novas com cópia dos chunks (embeddings inclusive) e fontes, no próprio banco.
  Alternativa descartada: fechar a redação inteira (perde o que se sabia da parte não reescrita).
- **Fechamento do snapshot anterior.** A versão nova fecha em `valid_during.from` o intervalo das
  versões anteriores ainda abertas do documento; elas continuam `published` e citáveis.
- **Embeddings só das redações novas.** Texto = `embeddingText(heading_path, conteúdo)`, chave do
  cache = hash dele + modelo (o mesmo da F2). `EmbedPending` deduplica por hash, lê o cache, planeja
  lotes (`planEmbeddingBatches`), roda o primeiro lote sozinho (valida 1.024 dimensões) e os demais
  com concorrência 2; `EmbeddingUnavailableError` (rede, HTTP, 429) é repetido com backoff
  exponencial (1 s, 2 s, 4 s; 4 tentativas). Cada lote grava o cache e soma o custo ao run antes do
  próximo.
- **Orçamento.** `NeuronMeter` recebe o `onUsage` do adapter (custo real: `result.meta.neurons` ou o
  header `cf-ai-neurons`); sem custo informado (o fake), cobra a estimativa conservadora
  (`ceil(chars/3)` tokens × 1.075 neurons por milhão). Antes de cada lote, a estimativa é reservada
  contra `EMBED_NEURON_BUDGET − Σ ingestion_runs.neurons` dos runs iniciados no dia de
  `America/Sao_Paulo` (o início vem do `Clock`). Não coube → `budget_exhausted` sem publicar, e o
  CLI sai com 75. Coluna nova `ingestion_runs.neurons` (a `neurons_est` da F2 continua para a
  estimativa).
- **Fila de revisão idempotente.** `review_queue` ganha `stable_key`, `note_hash` (`reviewNoteHash`:
  hash da nota original, ou de `reason:<motivo>` sem nota), `provision_version_id`,
  `document_version_id` e um índice único parcial `(stable_key, note_hash) WHERE status = 'open'`;
  o insert usa `ON CONFLICT DO NOTHING`. Reingerir não duplica itens.
- **Chunks sem versão até o fim do run.** `corpus_version = 0` na escrita; o `RefreshCoverage`
  grava o `corpus_versions` novo (por último) e carimba esses chunks. `covered` é a
  `range_agg(valid_during)` das redações publicáveis atuais da família; `verified_at` é a data do
  run; `gaps`/`gap_reason` são limpos. Sem família a recalcular, não grava versão nova.
- **Guarda de tamanho e `--bulk`.** `pg_database_size(current_database())` acima do limite (800 MB,
  configurável) aborta antes de cada versão. `--bulk` (recusado fora do staging) derruba o
  `chunks_embedding_hnsw` no início do run; o fechamento sempre o garante (`CREATE INDEX IF NOT
  EXISTS` numa transação com `SET LOCAL maintenance_work_mem = '512MB'`), inclusive depois de um run
  que caiu.
- **CU-s.** `GET https://console.neon.tech/api/v2/projects/{id}` → `project.compute_time_seconds`
  no início e no fim; a diferença vai a `cu_seconds`. Sem `NEON_API_KEY_STAGING` ou
  `NEON_STAGING_PROJECT_ID`, ou com a API fora, `null` (a medição nunca derruba o run).
- **Snapshot.** Leitura por cursor (`DECLARE … CURSOR`, `FETCH 1000`) numa transação `REPEATABLE
  READ READ ONLY`; cada tabela vira JSON Lines comprimido por streaming com o zstd do `node:zlib`
  (Node 24, estabilidade 1); tipos sem JSON nativo (uuid, date, ranges, `halfvec`) saem como texto
  canônico do Postgres, e o `halfvec_out` (decimal mais curto) volta idêntico. Filtros: só versões de
  documento `published`/`superseded`, só redações e chunks `auto`/`approved` (e o que depende
  deles); `embedding_cache`, `ingestion_runs` e `review_queue` ficam de fora. O manifesto é gravado
  por último. Retenção: as 3 versões mais recentes no store `corpus-snapshots`.
- **Promoção.** Confere manifesto (zod), hash da última migração (`drizzle.__drizzle_migrations`,
  ordem `created_at`), versão do destino (não pode estar à frente) e tamanho + sha256 de cada
  arquivo, e só então abre a transação: tabelas temporárias carregadas por `jsonb_to_recordset`,
  contagem igual à do manifesto, mescla por chave natural com remapeamento de IDs (ADR 0025),
  `knowledge` fechado na data da promoção para as linhas ausentes, `provision_versions` em duas
  passadas (as fechadas no snapshot antes das abertas, porque o `pv_no_overlap` é conferido linha a
  linha), `coverage` preservando `verified_at`/`gaps`/`gap_reason` do destino quando mais recentes,
  `corpus_versions` por último (numeração do staging, com `setval`) e a invariante de fonte
  publicada. Alternativa descartada: `pg_dump`/`COPY` (ferramenta externa no runner, sem filtro nem
  sha256 por arquivo).
- **Composição.** `createIngestionContainer(env, config, deps)` monta tudo com um pool próprio
  (`teko-ingest`, 4 conexões: 2 lotes em voo e a transação). `deps` traz o `BlobStore` (Netlify ou
  memória), o `Clock`, o `fetch` do Neon e, nos testes, a fábrica de embeddings e os limites de lote.
  As variáveis chegam por `config` até a frente D colocá-las no `config/env.ts`.

## Risks / Trade-offs

- Processar versões de um documento fora de ordem cronológica gera fechamentos estranhos (o
  fechamento nunca fica vazio, mas a ordem importa): o `load` ordena por `published_on`.
- Reingerir o staging do zero muda os IDs das redações; a promoção seguinte as trata como novas e
  fecha as antigas na produção (histórico de conhecimento maior, resultado correto).
- `node:zlib` zstd é experimental no Node 24 (pode emitir `ExperimentalWarning`); trocar o
  compressor muda só o `pg-snapshot-codec`.
- O exportador segura uma transação de leitura enquanto sobe os arquivos ao Blobs (minutos). Só o
  owner faz isso, sem `idle_in_transaction_session_timeout`.
- Os neurons de um run que começa antes da meia-noite contam no dia em que ele começou.

## CLI e fontes (frente D)

- Manifesto: `corpus/sources.yaml` agrupa fontes por documento (metadados uma vez só). Modos `pinned` (sha256 obrigatório e conferido), `live` (RCTE.htm, CTE.htm) e `ws-tabela` (versão atual pelo `consultarVersoesTabelasExternas`, metadados `externalTable` no descritor). Fonte indisponível fica com `enabled: false` e motivo, para não perder o registro.
- Vigência da versão: `leiaute` usa `leiautePeriodIntervals` sobre as versões habilitadas (corretivas do mesmo período dividem o intervalo; quem fecha o knowledge é a reconciliação); `nt` usa o período do leiaute (efeito e obrigatoriedade padrão no início dele); `publication` usa `publicationIntervals`. Assim o Guia 3.1.9 fica `[2025-01-01, 2026-01-01)` e 3.2.0–3.2.4 `[2026-01-01, ∞)`, como na fixture.
- SafeFetcher sobre `node:https` (não `fetch`): o `lookup` do socket revalida o DNS, o que fecha o DNS rebinding sem depender de `undici`. Allowlist = hosts das fontes habilitadas.
- Blobs: `{family}/{docSlug}/{versão}/{sha256}.{ext}`; versão = rótulo curto de `sources.yaml`, `v<versao>` nas tabelas, slug do rótulo parseado nos consolidados. Docling por parte: `{sha256}[-p<a>-<b>].json`; `blobDocling` do caso de uso aponta a primeira parte.
- `discover` lê do Blobs o raw de fonte pinned já gravado (sem tocar a origem) e só manda ao Docling as partes sem `docling.json`. Pin divergente, HTTP de erro e WS fora do ar ficam em `plan.errors` (exit 1, plano gravado).
- `load`: falha de uma fonte não para as outras; run `failed` sem snapshot nem lock (exit 1). `budget_exhausted` → para, recalcula cobertura, exit 75. Lock só é reescrito quando o conteúdo muda (sem PR de lock vazio). `DatabaseSizeLimitError` derruba o run com mensagem própria.
- Overrides entre parser e caso de uso; `note_hash` = `reviewNoteHash(hasher, flag)` do caso de uso (o domínio recebe a função).
- Desvio: o SafeFetcher só aceita https, então os Guias 3.0.1–3.1.8 (só em http no portal antigo) ficaram desabilitados; a cobertura da EFD ICMS/IPI começa em 2025-01-01.
- IDs do Context7: `/netlify/primitives`, `/eemeli/yaml`, `/colinhacks/zod`.

## Fontes Context7

| Biblioteca                | ID Context7                                | Versão conferida | Tópicos                                                                                        |
| ------------------------- | ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| Node.js (`node:zlib`)     | `/nodejs/node/v24.22.2`                    | 24.x             | `createZstdCompress`/`createZstdDecompress`, `zstdCompressSync`, estabilidade 1                |
| Neon API                  | `/websites/neon`                           | API v2           | `GET /projects/{project_id}`, `compute_time_seconds`, `consumption_period_start`               |
| Drizzle ORM / drizzle-kit | `/websites/rqbv2_drizzle-orm-fe_pages_dev` | 1.0.0-rc.5       | tabela de migrações (`drizzle.__drizzle_migrations`: `hash`, `created_at`, `name`), `generate` |
| node-postgres             | `/brianc/node-postgres`                    | 8.23.1           | `pool.connect`/`release`, transação manual (`BEGIN`/`COMMIT`/`ROLLBACK`), parâmetros           |
| pgvector                  | `/pgvector/pgvector`                       | 0.8.6            | `halfvec_out` (texto), HNSW criado depois da carga, `maintenance_work_mem`                     |

A tabela de migrações do Drizzle 1.0 RC foi conferida também no código instalado
(`drizzle-orm/pg-core/async/session.js`: `id`, `hash`, `created_at`, `name`, `applied_at`).
