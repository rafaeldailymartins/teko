# Ingestão, vigência e avaliação

A ingestão roda só no GitHub Actions (nunca na Vercel): baixa as fontes oficiais, extrai, aplica
as regras de vigência, grava o corpus no staging, avalia e propõe o snapshot que o release promove
para a produção. Os artefatos ficam no GitHub Releases (ADR 0030); a avaliação segue a ADR 0031.

## Corpus por ondas

| Onda / fonte                                     | Origem                                                                                   | Extração                                | `validity_basis`                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| **C1** Guia Prático EFD ICMS/IPI + NTs           | gov.br/sped (atuais) e `http://sped.rfb.gov.br` com pin (Guias de 2021 a 2024, ADR 0028) | Docling (tabelas de registros e campos) | `leiaute_period` (Guia), `legal_effect` (NT) |
| **C1** EFD-REINF                                 | pacote de XSD do gov.br/sped (texto da `xs:documentation`)                               | XSD via `htmlparser2` em `xmlMode`      | `leiaute_period`                             |
| **C1** CTE (Lei 11.651/1991, Livro I, Título II) | `appasp.economia.go.gov.br/…/Cte/CTE.htm`                                                | máquina de estados HTML                 | `legal_effect`                               |
| **C1** RCTE (Decreto 4.852/1997), corpo          | `…/Rcte/RCTE.htm`                                                                        | máquina de estados HTML                 | `legal_effect`                               |
| **C2** Guia Prático EFD-GO                       | página índice do portal de Goiás                                                         | Docling                                 | `publication_approx`                         |
| **C2** Tabelas GO 5.1.1, 5.2, 5.3 e 5.5          | WS de Tabelas Externas do SPED (TXT cp1252, SHA-1 nos metadados)                         | parser TXT em Node                      | `table_declared`                             |
| **C3** RCTE Anexos VIII e IX (F10)               | HTML de 57 e 73 MB                                                                       | o mesmo parser, em streaming            | `legal_effect`                               |

Arquivos em `corpus/`: `sources.yaml` (família, URL, sha256, rótulos, datas de efeito, `ocr`),
`leiaute-periods.yaml` (curado do Ato COTEPE 44/2018), `overrides/*.yaml` (revisão manual, chave
`(stable_key, note_hash)`, aprovação por PR), `watch.yaml` (páginas monitoradas) e
`corpus.lock.json` (o snapshot promovível, com linhagem e resultado do eval).

Fontes desabilitadas, até curadoria: Guia 3.1.8 (inverteria o conhecimento de 2025, ADR 0028), os
Guias sem efeitos e os de 2019–2020, NTs da REINF e o XSD de CNPJ alfanumérico.

## `tools/ingest` (Python)

- `pyproject.toml` + `uv.lock`, `[tool.uv] exclude-newer = "7 days"` (a mesma regra do pnpm), torch
  CPU de índice explícito. Dev: ruff `select=["ALL"]`, pyright strict, pytest com cobertura ≥ 85%,
  hypothesis. Vulnerabilidades pelo osv-scanner sobre o `uv.lock` (o `pip-audit` saiu, ADR 0032).
- Docling com TableFormer V1 `ACCURATE`, sem OCR por padrão, `document_timeout=3600`, sem serviços
  remotos (ADR 0011). Guias grandes são divididos em partes de 125 páginas por `page_range`
  (cerca de 9 a 15 min por parte, 6 em paralelo).
- Saída `out/<sha256>/{docling.json, manifest.json}`; o manifesto registra a versão do Docling e a
  `EXTRACTOR_REVISION`. Modelos (`layout` e `tableformer`) baixados por `docling-tools` e em cache
  pela chave do `uv.lock`.

## Pipeline Node (CLI)

`pnpm --filter @teko/api cli ingest …` (no Actions, `node dist/cli.mjs`): `discover` (download e
sha256), `extract` (Docling, matriz por parte), `load` (parse, reconciliação, embeddings, escrita),
`snapshot` (export e promoção), `eval-fixture`, `sources-watch` e `coverage-mark`.

**RCTE/CTE.** Decodificação `windows-1252` explícita e `htmlparser2` em streaming. Parágrafos em
ordem: `TextoRevo` empilha redação superada, `NotaVigncia` fecha o intervalo em `[a, b+1)`,
`NovaRedao`/`NovaRedRev` abrem redação nova, `ParNormal` é a vigente. A ordem dos parágrafos vale
mais que o texto da nota. Pivô de ano: 97 no RCTE, 91 no CTE. Medido em 2026-11-11: 95,8% das
`NotaVigncia` do RCTE e 96,6% das do CTE convertidas; o resto vai para revisão.

**Regras de vigência** (`domain/corpus/validity.ts`; intervalos meio-abertos, upper `NULL`, nunca
`infinity`):

1. **Guia Prático:** tempo válido de `leiaute-periods.yaml` até a versão seguinte; versão corretiva
   no mesmo período fecha o `knowledge` da anterior.
2. **NT:** `optional` em `[optional_from, mandatory_from)`, `mandatory` depois; efeito anterior à
   publicação marca `retroactive`.
3. **RCTE/CTE:** "sem vigência" não é indexada; "EXAURIU-SE" fecha ou vai para revisão;
   renumeração mantém o `stable_key` e grava o rótulo antigo em `provision_labels`; no CTE, redações
   que terminam até 1997-01-01 vão para revisão. `document_versions.valid_during` dos consolidados
   descreve o snapshot, não a vigência do dispositivo.
4. **EFD-GO:** `[published_on, próxima publicação)`. **Tabelas GO:** DATA INÍCIO/FIM por código,
   com aviso de que não é vigência jurídica.
5. **Anomalias** vão para `review_queue` com `review_status='pending'`: visíveis no staging,
   excluídas da produção; não abortam a publicação do documento.

**Chunking.** Guia: um pai por registro e um filho por campo (`heading_path` como `EFD ICMS/IPI >
Bloco C > Registro C170 > Campo 07 VL_ITEM`), tabelas costuradas entre páginas e serializadas linha
a linha (`Cabeçalho: valor; …`), com o fim de linha como ponto de corte. Leis: caput pai, um filho
por §, inciso ou alínea, teto de cerca de 1.200 tokens. `content_hash` sobre NFC com whitespace
colapsado; versões consecutivas iguais viram uma só redação com intervalo alargado.

**Reconciliação incremental** (ADR 0025): redação que cruza a janela da versão nova e não aparece
nela tem o `knowledge` fechado; os trechos fora da janela voltam como linhas novas (sem copiar
embedding de linha fechada). Reprocessar a mesma versão não deixa duas redações conhecidas no mesmo
dia.

**Revisões que forçam reprocesso:** `PARSER_REVISIONS` por parser (ADR 0026) e `EXTRACTOR_REVISION`
na chave do cache do Docling. A revisão 1 do extrator mantém as chaves atuais; um teste falha se a
versão do `docling` no `uv.lock` mudar sem a revisão mudar.

**Fontes "live"** (RCTE, CTE) mudam de sha256 sem mudar de consolidação: se a impressão digital do
resultado parseado (`stable_key`, `content_hash`, vigência) for igual à da última versão publicada,
o item volta `unchanged`, sem versão nova.

## Embeddings e orçamento de neurons

- `@cf/baai/bge-m3` no Workers AI (`[n, 1024]`, `halfvec`), lotes de 50, concorrência 2, backoff. O
  texto embutido é `heading_path` + conteúdo, e o `embedding_cache` é indexado pelo hash desse
  texto.
- O custo real vem em `result.meta.neurons` e é somado contra o `EMBED_NEURON_BUDGET` por **dia
  UTC**, que é quando a Cloudflare zera a cota. O estouro da cota diária da conta (429 / código de
  cota) vira `budget_exhausted`: o run para com código 75 e o seguinte retoma do checkpoint (o
  próprio `embedding_cache`, commitado por lote).

| Uso da conta (10k neurons/dia) | Neurons/dia                   |
| ------------------------------ | ----------------------------- |
| Ingestão                       | 8.000 (`EMBED_NEURON_BUDGET`) |
| Produção (perguntas)           | 800                           |
| Staging (perguntas)            | 200                           |
| Folga                          | 1.000                         |

## Modelo do corpus

| Tabela                      | Colunas-chave                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corpus.documents`          | `slug` único, `family`, `jurisdiction`, `title`, `issuer`, `source_url`                                                                                                                |
| `corpus.document_versions`  | `version_label`, `published_on`, `valid_during`, `consolidated_until`, `sha256` único, `status`, `parser_revision`, `ingestion_run_id`                                                 |
| `corpus.provisions`         | `stable_key` único, `document_id`, `kind`, `parent_id`, `sort_path`; `provision_labels` guarda renumerações                                                                            |
| `corpus.provision_versions` | `valid_during`, `knowledge`, `modality`, `validity_basis`, `retroactive`, `review_status`, `text`, `structured`, `content_hash`; `pv_no_overlap` exclui sobreposição entre publicáveis |
| `corpus.chunks`             | conteúdo, `citation_label`, `heading_path`, colunas desnormalizadas de vigência e status, `tsv` gerado, `embedding halfvec(1024)`, `embedding_model`                                   |
| `corpus.chunk_sources`      | todas as versões de documento que contêm o chunk                                                                                                                                       |
| `corpus.embedding_cache`    | PK `(content_hash, model)`                                                                                                                                                             |
| `corpus.ingestion_runs`     | `git_sha`, `status`, `neurons`, `cu_seconds`, `db_bytes`, `report`                                                                                                                     |
| `corpus.corpus_versions`    | `id` (a atual é `max(id)`), `run_id`, `notes`                                                                                                                                          |
| `corpus.coverage`           | `covered`, `verified_at`, `gaps`, `gap_reason`, fonte(s) que causaram a lacuna e a data em que foi detectada                                                                           |
| `corpus.review_queue`       | itens de revisão, com chave dos overrides e índice único parcial nas abertas                                                                                                           |

**Armazenamento** (70% do banco são vetores; limite de 1 GB do Neon): HNSW e GIN parciais
`WHERE upper_inf(knowledge)`, `embedding = NULL` ao fechar o `knowledge` (a busca nunca lê vetor
fechado), snapshot só com embeddings de chunks abertos e poda, ao fim de um run verde, dos hashes do
`embedding_cache` que nenhum chunk aberto usa. O `--bulk` (só staging) recria o HNSW parcial com
`maintenance_work_mem` de cerca de 256 MB, e um run interrompido o recria no início do seguinte.

**Guardas do `load`:**

- **tamanho:** aborta antes de embutir se `tamanho atual + chunks novos × bytes por chunk` passar
  de 800 MB (bytes por chunk configurável; cerca de 10,6 KB medidos no staging);
- **disjuntor de mudança em massa:** falha o item antes do commit se `close/open` passar de 20% dos
  dispositivos, se os dispositivos caírem mais de 10% ou se a taxa de `pending` dobrar;
- **saúde do corpus por versão de documento:** compara com a `corpus_version` anterior
  (dispositivos, registros, campos, chunks, `% pending`, itens de revisão) e falha com queda acima
  de cerca de 5% ou `pending` acima do limiar da família.

As duas últimas liberam o caso legítimo com `--accept-churn` (input do `ingest.yml`). O `load`
imprime uma linha por item, mostra a fila de `pending` por família e motivo, e não roda o
`refreshCoverage` em run `failed`.

## Artefatos no GitHub Releases

A porta `BlobStore` tem o adapter de GitHub Releases (ADR 0030), escolhido por `BLOB_STORE`
(padrão `github-releases`). Releases **prerelease**, com `make_latest=false`, assets nomeados pelo
sha256:

| Release (tag)                   | Conteúdo                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `corpus-v<N>`                   | snapshot da `corpus_version` N (um `.jsonl.zst` por tabela + `manifest.json`) |
| `corpus-raw-<shard>`            | arquivos baixados das fontes                                                  |
| `corpus-docling-r<rev>-<shard>` | saída do Docling por `EXTRACTOR_REVISION`                                     |
| `corpus-watch-state`            | estado do `source-watch` (ETag, Last-Modified, hashes)                        |
| `corpus-eval-history`           | métricas do `corpus-eval` por `corpus_version`                                |

- Shards por prefixo do sha256, por causa do limite de 1.000 assets por release.
- Gravação só com `GITHUB_TOKEN` de `contents: write` nos jobs que gravam; leitura é pública.
- Migração em duas etapas: C1 traz o adapter, o comando `ingest blobs-migrate` (idempotente, confere
  o sha256) e o workflow `blobs-migrate.yml`; C2 remove o adapter da Netlify, o comando e o workflow.

## Snapshot, promoção e rollback

1. Depois de uma ingestão verde no staging, o CLI exporta o snapshot (tabelas do schema `corpus` na
   ordem de FK, sem `embedding_cache`, `ingestion_runs`, `review_queue` nem linhas `pending` ou
   `rejected`) com o `manifest.json` (contagens, sha256 de cada arquivo, hash da última migração e
   a linhagem) e abre o PR do `corpus.lock.json`, **só depois do `corpus-eval` verde** e com as
   métricas no corpo. A branch do PR leva o `run_id`.
2. No release, o `promote-corpus` (environment `production`) confere os sha256 e o hash de
   migração, faz upsert por chave natural sem recalcular embeddings, fecha o `knowledge` do que
   saiu e grava `corpus_versions` por último. Na cobertura, a produção mantém o `verified_at` maior
   e só mantém uma lacuna detectada **depois** da data de referência do snapshot. 0 neurons, sem ler
   o banco do staging.
3. **Rollback:** `promote --rollback` repromove um snapshot antigo como `corpus_version` nova. A
   retenção nunca apaga um snapshot referenciado pelo lock vigente. Runbook em
   `docs/runbooks/rollback-corpus.md`.

**Linhagem** (no `manifest.json` e no `corpus.lock.json`): modelo de embedding, `PARSER_REVISIONS`,
`EXTRACTOR_REVISION` e versão do Docling, reranker, git sha do run e o resultado do eval.

## Monitoramento de mudanças (`source-watch.yml`)

- Cron diário `0 9 * * *`, `cli sources-watch`, GET condicional (ETag e Last-Modified), User-Agent
  `teko-corpus-watch (+github.com/rafaeldailymartins/teko)`, no máximo 1 req/s por host.
- Páginas: índices SPED (EFD ICMS/IPI e REINF), `RCTE.htm`, `CTE.htm`, os sumários anuais
  `INDICES/sumarios/Decretos_{yyyy}.htm`, `leis_atualizadoras.htm`, Guia EFD-GO e o WS de Tabelas
  Externas. O cabeçalho "CONSOLIDADO ATÉ O DECRETO Nº …" é o sinal barato; o diff é por dispositivo.
- Job `detect` (environment `staging`): lê e grava o estado no release `corpus-watch-state`, grava
  `discovered.json` e chama o `ingest.yml` (`workflow_call`) para o staging. Não toca o banco.
- Job `mark-coverage` (environment `corpus-watch`, role `teko_watch` nos dois projetos): sem
  mudança, um `UPDATE … SET verified_at = <dia do run>`; com mudança, também `gaps` e `gap_reason`
  a partir da data de efeito, guardando a fonte que causou a lacuna. Família com página não
  verificada no dia fica fora do avanço. A ingestão só limpa a lacuna quando a fonte que a causou é
  publicada no run.
- Promoção nunca é automática: passa pelo PR do lock e pelo release.
- O harden-runner do `source-watch` está em `audit` e passa a `block` com os endpoints observados no
  primeiro run agendado ([status](../status.md)).

## `ingest.yml`

| Job           | O que faz                                                                             |
| ------------- | ------------------------------------------------------------------------------------- |
| `discover`    | download, sha256, plano                                                               |
| `extract`     | Docling por parte, `ubuntu-24.04`, `timeout-minutes: 330`                             |
| `load`        | parse, reconciliação, embeddings, guardas, snapshot                                   |
| `corpus-eval` | retrieval eval contra o staging, com embeddings e reranker reais (`dev` e `holdout`)  |
| `lock-pr`     | `needs: [load, corpus-eval]`, exige sucesso dos dois; abre o PR do lock               |
| resumo        | tamanho do banco (aviso acima de 400 MB), neurons, fila de `pending`, métricas com IC |

Modo **`eval-only`**: roda só o `corpus-eval` contra o staging, sem reingerir, para PRs que mexem em
busca, reranker ou SQL (disparo manual ou label `corpus-eval`, só em PR do próprio repositório).
O harden-runner do `ingest.yml` fica em `block`.

## Avaliação (RAGOps, ADR 0031)

**Golden em dois conjuntos** (`apps/api/evals/datasets/`):

- **`dev`**: os 50 casos revisados pelo mantenedor em 2026-11-11 (EFD ICMS/IPI 15, REINF 8,
  RCTE/CTE 12, EFD-GO e tabelas 5, recusas 6, ambíguos 4). É onde se ajustam parâmetros.
- **`holdout`**: 40 a 60 casos novos que **nunca orientam parâmetros**: paráfrase em linguagem de
  contador, vários com mais de um dispositivo esperado, mais casos em `en`, registros e campos fora
  da fixture, perguntas sem resposta dentro da cobertura. Curadoria assistida por LLM, pendente de
  revisão do mantenedor (`curated_by`).
- Todo caso tem `source_quote` real, conferida no texto da fonte. **Mudar o esperado de um caso
  exige `source_quote` novo.**

**Retrieval na fixture** (todo PR que toca busca ou ingestão; sem segredo, roda em forks): a
fixture única (`apps/api/test/fixtures/corpus`, 1.574 chunks de textos reais, vetores BGE-M3 reais
em `embeddings.json.gz`) é semeada pelo CLI real; `HybridSearch` in-process com o fake de embeddings
estrito e sem reranker. Gates do `thresholds.json`: recall@10 ≥ 0,90, MRR ≥ 0,70, vigência = 1,00,
clarificação e data de referência = 1,00, recusa fora da cobertura = 1,00. recall@10 e MRR contam
dispositivos distintos (`stable_key`). Medido na F2: recall@10 0,925, MRR 0,771.

**`corpus-eval`** (corpus real do staging, embeddings e reranker reais): limites próprios para `dev`
e `holdout`; resumo com intervalo de confiança (Wilson para recall, erro-padrão para MRR); **bloqueia
o PR do lock**. Partida: recall@10 0,925 e MRR entre 0,66 e 0,68 (trava de regressão ≥ 0,65). A meta
de MRR ≥ 0,70 da F4 é decidida pelo **holdout**. Métricas gravadas por `corpus_version` no release
`corpus-eval-history`.

**Geração** (F8, stack de CI com `APP_ENV=ci` e `POST /api/v1/_eval/answer`): asserções
determinísticas (status, regex de citação, `stable_key`, versão, vigência, data ecoada,
disclaimer, ausência de PII), `context-faithfulness` e `llm-rubric` em até 10 casos. Chaves só do
projeto de CI (environment `evals`). Juiz diferente do gerador quando o gerador for o Groq; eval por
modelo da cadeia. Em PR, 15 casos se `llm` foi afetado (só PR do próprio repositório); completo no
semanal e no pré-release. Gates: faithfulness ≥ 0,90 e citação correta ≥ 95%.

**Red team** (F8, semanal e pré-release, stack de CI): plugins locais do promptfoo
(`prompt-extraction`, `pii:direct`, `overreliance`, `hallucination`, `excessive-agency`, `policy`),
estratégias `jailbreak-templates`, `base64`, `leetspeak` e `jailbreak:tree`, em `en` e `pt-BR`,
com geração remota, compartilhamento e telemetria desligados. Injeção indireta e RAG poisoning em
casos YAML com um chunk envenenado. Gate: ASR ≤ 5% no geral e 0% em extração, PII e policy.

**Sinais em produção e laço de feedback** (F6/F8): taxa de recusa por motivo, fração `lexical_only`,
citações invalidadas pelo `CitationValidator`, distribuição do score do reranker e frequência do
sentinel `INSUFICIENTE` como métricas no Grafana; 👎 vai para a annotation queue do Langfuse, com
triagem mensal, e os casos aprovados entram no `holdout`.

## Testes do pipeline

- Golden do RCTE art. 76 (bytes cp1252 reais, §§ 5º a 10): § 6º acréscimo
  `[2003-09-12, 2004-11-04)`, nova redação `[2004-11-04, 2009-11-23)`, revogação a partir de
  2009-11-23; §§ 8º e 9º a partir de 2026-07-28.
- Casos de "sem vigência", retroativo, "vIGÊNCIA", "exauriu-se", renumeração, prorrogação, CTE de
  1995, tabela do Docling que quebra de página e anomalia sobreposta.
- Propriedades (fast-check): intervalo inclusivo → meio-aberto, merge de versões idênticas, sem
  sobreposição `mandatory`, cobertura = união das vigências, chunker sem perda de texto, IDs
  determinísticos, hash invariante a whitespace.
- Integração: segunda execução gera 0 linhas e 0 neurons; retomada após o código 75; snapshot
  promovido num banco vazio dá resultados idênticos no `HybridSearch`; medição de
  `pg_total_relation_size` antes e depois das podas.
