# Design

## Context

A produção recebe o corpus só pelo snapshot que o staging exporta (ADR 0025): o `corpus.lock.json`
aponta o manifesto (`snapshot.manifestKey`, `corpusVersion`, `migration` e `manifestSha256`), e o
`PromoteSnapshot` exige a mesma migração no destino, recusa destino mais novo e confere o sha256 de
cada arquivo. O deploy de produção (`deploy.yml`, tag `v*`) roda as migrações no job `deploy`, com o
environment `production` e o revisor obrigatório, e não promovia o corpus.

## Goals / Non-Goals

**Goals:** a produção sai de cada release com o corpus do lock do commit; o passo é idempotente,
nunca volta o corpus e falha antes da Vercel numa recusa; nenhuma aprovação a mais.

**Non-Goals:** reexportar o snapshot da versão 14 (o mantenedor roda a ingestão no staging); mudar a
promoção manual nem o rollback de corpus; o `release.yml` completo da F9.

## Decisions

- **Passo no job `deploy`, não job próprio.** Cada job que referencia o environment `production`
  espera a aprovação do revisor (o `deployment: false` não muda isso); um job `promote-corpus`
  somaria uma terceira aprovação. O job `deploy` já tem a URL do owner (`NEON_PROD_MIGRATE_URL`),
  o egress do Neon (`*.neon.tech:5432`) e os hosts do GitHub que servem os assets dos releases
  (`api.github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`), e o
  `contents: read` basta para ler os releases `corpus-v<N>`. Nenhum host novo no harden-runner.
- **Logo depois das migrações**, antes do env sync e do `vercel deploy`: a promoção exige a mesma
  migração do snapshot, e uma recusa não deixa nada publicado na Vercel. O corpus promovido é
  compatível com o schema já migrado, então a deployment antiga, que continua servindo até o
  `vercel promote`, lê o corpus novo sem problema.
- **`--lock` com um caso de uso próprio (`PromoteLockedSnapshot`).** Ele lê os bytes do manifesto
  uma vez, confere o sha256 contra o lock e a versão, e só então decide: destino na versão do lock
  (`up-to-date`) ou à frente (`target-newer`, depois de um rollback de corpus) não escreve nada;
  destino vazio ou mais antigo segue para as checagens e a escrita do `PromoteSnapshot`, sobre o
  manifesto já conferido (sem uma segunda leitura entre a conferência e a escrita).
- **Idempotência explícita, não pelo upsert.** Repromover o mesmo snapshot é seguro (contagens
  iguais, cenário "Promoção repetida"), mas reescreve as tabelas inteiras no Neon Free a cada
  deploy. A comparação com `max(corpus_versions.id)` evita a escrita: as versões da produção são as
  do staging (o `corpus_versions` é copiado com os IDs do staging), então a mesma versão é o mesmo
  snapshot. A checagem de migração fica de fora no `up-to-date`: sem escrita, ela não importa. Isso
  vale também para a reexportação da mesma versão com a migração atual (o `load` reexporta quando a
  migração do lock fica para trás): o conteúdo é o mesmo, e a produção já migrou o schema dela.
- **`target-newer` avisa e segue.** Depois de um rollback de corpus (que cria uma versão nova acima
  da do lock), recusar travaria todo deploy de código até o próximo PR do lock; o runbook já diz que
  a produção fica como está até lá. O passo nunca chama o `--rollback`.
- **Env próprio da CLI do snapshot.** O `loadCliEnv` exige `EMBEDDINGS_PROVIDER` (e as credenciais
  do Workers AI) com `DATABASE_URL`, e o `createIngestionContainer` monta os embeddings. O
  `loadSnapshotEnv` lê só `DATABASE_URL`, `BLOB_STORE`, `GITHUB_TOKEN` e `GITHUB_REPOSITORY`, com as
  mesmas regras do store, e o `createSnapshotContainer` monta só o repositório, o codec e o store.
  O `snapshot export` passa pelo mesmo caminho.
- **CLI construída no próprio passo** (`pnpm --filter @teko/api build`, como no `ingest.yml`), com o
  `apps/api/dist` apagado no fim (`trap`): o upload dos source maps, mais adiante, lê o `apps/api/dist`
  do artifact do build, com os chunk ids injetados.

## Risks / Trade-offs

- Um lock exportado antes de uma migração nova trava o release até o staging reexportar. É o
  comportamento desejado (ADR 0025): o corpus da produção sempre corresponde ao schema.
- O passo soma o build da API (cerca de 1 min) ao job `deploy` da produção.
- Se o corpus for promovido e um passo seguinte falhar, o corpus fica; a deployment anterior lê o
  mesmo schema, e o próximo deploy encontra `up-to-date`.

## Fontes (Context7)

- `/websites/github_en_actions`: jobs que referenciam um environment com revisores esperam a
  aprovação, inclusive com `deployment: false`; segredos do environment só depois da aprovação.
