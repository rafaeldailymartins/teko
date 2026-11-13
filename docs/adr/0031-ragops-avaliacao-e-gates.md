---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0031 — RAGOps: avaliação dev/holdout, gate do corpus-eval, linhagem e rollback

## Contexto e problema

A F3 deixou o corpus do staging medido pelo `corpus-eval` (ADR 0027), mas com quatro lacunas que a
revisão de arquitetura de 2026-11-12 apontou antes da F4:

- **O gate não guardava a porta.** O `lock-pr` dependia só do `load`: o PR do lock (a porta do
  corpus para a produção) abria com o `corpus-eval` ainda rodando ou vermelho, e cabia à revisão
  lembrar de olhar o job.
- **Ajuste e medida no mesmo conjunto.** Os 50 casos do golden escolheram o número de candidatos do
  reranker (ADR 0027) e receberam `staging_validity`; medir a F4 (meta de MRR 0,70) nesses mesmos
  casos dá um número otimista. Com 50 casos, um caso vale 0,025 de MRR e o intervalo de confiança
  do MRR passa de ±0,10, e nada no resumo dizia isso.
- **Sem caminho entre o eval e o lock.** Quando o eval reprovava por um erro do golden (o E110 em
  2026-11-12), o lock ficava atrás do staging até um novo ingest. Também não havia como medir uma
  mudança de busca (reranker, SQL, embeddings) contra o corpus real sem reingerir, e o reranker e os
  embeddings nem marcavam o grupo `rag` do escopo afetado.
- **Corpus sem linhagem nem volta.** O lock não diz com que parser, extrator, modelo e código o
  snapshot foi feito; uma queda de qualidade do parser só aparecia no eval (se aparecesse), e uma
  versão ruim promovida não tinha caminho de volta.

## Decisão

Aval do mantenedor em 2026-11-12 (pacote "antes da F4"). A parte de avaliação e workflow é desta
mudança (`add-ragops-gates`); a parte de ingestão é do pacote de ingestão (branch
`fix/ingestao-revisao`) e está registrada aqui para a decisão ficar num lugar só.

### 1. Golden em dois conjuntos

- **dev** (`evals/datasets/golden.yaml`, os 50 casos): onde se ajusta busca, reranker, limites e
  prompts. Roda na fixture do PR e no `corpus-eval`.
- **holdout** (`evals/datasets/holdout.yaml`, 53 casos novos): nunca orienta parâmetros. Roda só no
  `corpus-eval`, contra o corpus real (as perguntas não têm vetor na fixture, que tem um décimo do
  corpus). A meta de MRR 0,70 da F4 passa a ser medida aqui.
- O holdout foi escrito sem copiar o dispositivo (paráfrase, linguagem de contador), com 10 casos em
  inglês, 10 com mais de um dispositivo esperado, 38 dispositivos fora da fixture, recusas,
  ambíguos e 4 perguntas sem resposta dentro da cobertura (status `unanswerable`, métrica
  `sem_resposta`: a busca não pode recusar por cobertura nem pedir clarificação). Chaves, vigências
  e `source_quote` foram conferidos nos parsers da ingestão rodados localmente sobre as fontes
  públicas, nos textos da fixture e no texto dos PDFs. A curadoria é assistida por LLM e o
  `reviewed_at` fica nulo até a revisão do mantenedor.
- **Regra:** mudar o esperado de um caso exige um `source_quote` novo, conferido na fonte. Caso que
  reprova não é reescrito para passar; caso do holdout que orientou um ajuste vai para o dev, e o
  holdout recebe um caso novo no lugar.

### 2. Gates com intervalo de confiança

- `check-thresholds` mostra, por métrica, média, intervalo de 95% (Wilson nas proporções; média ±
  1,96 erro-padrão no MRR), gate, meta e número de casos.
- Suítes: `retrieval` (fixture, dev), `retrieval-corpus` (staging, dev; trava de regressão, MRR
  0,65) e `retrieval-holdout` (staging, holdout). No holdout, as métricas determinísticas (vigência,
  recusa, clarificação, data de referência, sem resposta) travam em 1,00; recall@10 e MRR ficam
  informativos (limite `null`) até a primeira medição, quando o mantenedor fixa o piso; a meta de
  MRR 0,70 da F4 fica em `metas` e aparece sem reprovar.

### 3. O corpus-eval guarda a porta do lock

- `lock-pr` depende de `[load, corpus-eval]` e só roda com o eval verde. O commit leva o
  `corpus/corpus.lock.json` e o `corpus/corpus.eval.json` (registro com a `corpus_version`
  avaliada, as métricas e intervalos dos dois conjuntos, o SHA do código e os provedores da busca);
  o corpo do PR traz as tabelas. Lock e registro precisam ter a mesma `corpus_version`.
- Branch do lock `chore/corpus-lock-<run_id>`: o `run_number` é por workflow e colidia entre o
  `source-watch` (que chama o `ingest.yml`) e o dispatch. O prefixo continua, porque o fechamento
  dos PRs de lock antigos depende dele.
- Histórico: cada `corpus-eval` do código de `develop` grava o registro no store `eval-artifacts`
  (`history/corpus-v<NNNNNN>/<run_id>.json`, pela porta `BlobStore`, para o backend dos artefatos
  mudar sem mexer aqui), também com o gate vermelho, e o resumo compara com o registro anterior.

### 4. Modo `eval-only`

O `ingest.yml` aceita `mode: eval-only`, que pula discover, extract e load e roda só o
`corpus-eval` contra o estado atual do staging.

- **Sem `ref` (dispatch em `develop`).** Se o eval passar e a `corpus_version` do staging estiver à
  frente do lock de `develop`, o `lock-pr` abre o PR do lock com o `corpus.lock.json` do artifact
  `corpus-lock` do run que exportou essa versão (procurado do mais novo para o mais antigo,
  retenção de 90 dias). É o caminho de um eval vermelho por causa do golden: corrige-se o golden e
  roda-se o `eval-only`, sem reingerir. Sem artifact (expirado), roda-se o ingest completo.
- **Com `ref` (SHA de um PR).** Para PRs que mexem em busca, reranker, embeddings ou SQL: o rótulo
  `corpus-eval` num PR do próprio repositório faz o `corpus-eval-label.yml` disparar o `ingest.yml`
  em `develop` com o SHA do PR. O environment `staging` não aceita `refs/pull/N/merge` (ADR 0024) e
  o PR não recebe segredos; o run avalia o código do PR e não abre PR de lock nem grava histórico.
- O reranker e os embeddings (`apps/api/src/adapters/out/{reranker,embeddings}/**`) entram no grupo
  `rag` do `affected-paths.yml`, e o grupo `docs` (`docs/**`, `openspec/**`, `**/*.md`) é criado
  para o `ci.yml` reconhecer o PR só de documentação.

### 5. Ingestão: linhagem, saúde e volta (pacote de ingestão)

- **`EXTRACTOR_REVISION`**, como o `PARSER_REVISIONS` da ADR 0026, na chave do cache do Docling e
  no `manifest.json`, com teste que falha se a versão do `docling` no `tools/ingest/uv.lock` mudar
  sem a revisão mudar. A revisão inicial mantém as chaves atuais.
- **Linhagem completa** no `corpus.lock.json` e no `manifest.json`: modelo de embedding,
  `PARSER_REVISIONS`, `EXTRACTOR_REVISION` e versão do Docling, reranker e SHA do código (os dados
  já existem no banco: `chunks.embedding_model`, `parser_revision`, `ingestion_runs.git_sha`).
- **Gate de saúde do corpus** no relatório do `load`, por versão de documento, contra a
  `corpus_version` anterior: dispositivos, registros e campos, chunks, fração `pending` e itens de
  revisão. Queda acima de cerca de 5% ou `pending` acima do limiar da família reprova o item;
  `--accept-churn` libera o caso legítimo. Junto, o disjuntor de mudança em massa da reconciliação
  (ADR 0025).
- **Rollback de corpus**: repromover um snapshot antigo explicitamente (`--rollback`) como uma
  `corpus_version` nova, sem apagar snapshots referenciados pelo lock vigente, com runbook em
  `docs/runbooks/rollback-corpus.md`. A versão nova passa pelo mesmo `corpus-eval` e pelo mesmo PR
  do lock.

### 6. Sinais online e laço de feedback (planejados)

- **F6 (observabilidade):** taxa de recusa por motivo (`out_of_coverage`, `no_evidence`), fração de
  respostas em `lexical_only`, citações invalidadas pelo `CitationValidator`, distribuição da nota
  do reranker (e a fração de buscas que caíram na ordem do RRF) e a frequência da sentinela
  `INSUFICIENTE`, por `corpus_version` e por modelo da cadeia.
- **F8 (avaliação de geração):** 👎 do usuário vai para a annotation queue do Langfuse; triagem
  mensal; o caso confirmado vira caso do holdout (com `source_quote`), e o que orientar ajuste vai
  para o dev. Eval de geração por modelo da cadeia (Gemini → Groq), com juiz diferente do gerador
  quando o gerador for o Groq. Os casos `unanswerable` medem a sentinela `INSUFICIENTE`.

## Consequências

- Boa: nada chega à produção sem o `corpus-eval` verde, e o PR do lock mostra o que foi medido.
- Boa: a meta da F4 é decidida num conjunto que não orientou o ajuste, com a incerteza à vista.
- Boa: um erro do golden não exige reingestão, e uma mudança de busca pode ser medida contra o
  corpus real antes do merge.
- Ruim: o holdout ainda não foi revisado pelo mantenedor. Um caso errado reprova o `corpus-eval`
  nas métricas determinísticas e segura o lock até a correção (com `source_quote` novo).
- Ruim: o `eval-only` de um PR roda código não mesclado com os segredos do staging. Mitigação: só
  PR do próprio repositório, só quem pode rotular, egress bloqueado, role `teko_app`.
- Ruim: o histórico depende do backend dos artefatos (hoje o Netlify Blobs; o GitHub Releases pela
  ADR 0030). A gravação falha sem derrubar o eval.
- Neutra: a fixture do PR continua medindo só o dev; os resultados ficaram iguais caso a caso
  (recall@10 0,925, MRR 0,771, demais 1,00).

## Alternativas consideradas

- **Holdout também na fixture.** Exigiria vetores para as perguntas e trazer à fixture os
  dispositivos fora dela; a fixture é circular por construção (o golden saiu dela) e deixaria de
  ser pequena.
- **Gate de recall e MRR no holdout desde já.** Um número nunca medido bloquearia o lock sem
  informação; o piso sai da primeira medição.
- **Campo `eval` dentro do `corpus.lock.json`.** Mudaria o schema do lock, que é do pacote de
  ingestão; o arquivo irmão (`corpus.eval.json`) vai no mesmo commit.
- **Workflow próprio de eval com environment `staging` em `pull_request`.** A regra do environment
  é avaliada contra `refs/pull/N/merge` (ADR 0024); o dispatch em `develop` com o SHA mantém os
  segredos fora do PR.
- **Regerar o lock a partir do banco no `eval-only`.** Exigiria o owner do staging e o Blobs no job
  do eval; o artifact do run que exportou o snapshot já é o lock certo.
