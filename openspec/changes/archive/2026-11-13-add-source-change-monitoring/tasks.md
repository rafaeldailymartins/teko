# Tasks

## 1. Configuração e sinais

- [x] 1.1 `corpus/watch.yaml` e loader com schema (`watch-config.ts`) — `watch-config.test.ts` (carrega o arquivo real)
- [x] 1.2 Leitura dos sinais (`signals.ts`, `htmlparser2`) sobre recortes reais (RCTE, CTE, decretos atualizadores, sumário 2026, leis atualizadoras, SPED, Guia EFD-GO, WS) — `signals.test.ts`

## 2. Casos de uso

- [x] 2.1 Portas `watch-signals.ts`, `watch-report.ts` e `watch-coverage-repository.ts`
- [x] 2.2 `WatchSources` (GET condicional, linha de base, pendentes, `{yyyy}`, erros por página, dry-run) — `watch-sources.test.ts`
- [x] 2.3 `MarkCoverage` (lacuna pela menor data de efeito, `gap_reason`, famílias excluídas) — `mark-coverage.test.ts`

## 3. Persistência e CLI

- [x] 3.1 `createPgCoverageWatchRepository` (um `UPDATE` sem mudança; transação com lacunas) e grants do `teko_watch` — `test/integration/watch/coverage-watch.test.ts`
- [x] 3.2 Handlers `runSourcesWatch` e `runCoverageMark` (+ `resolveWatchDatabaseUrls` e validação do `discovered.json`) — `run-sources-watch.test.ts`, `run-coverage-mark.test.ts`
- [x] 3.3 Fiação no `cli.ts`/`composition-root.ts` (orquestrador: `sources-watch` e `coverage-mark`)
- [x] 3.4 `coverage-mark` tolera banco sem o schema `corpus` (produção antes da primeira promoção) e mostra a causa do erro do `pg` — run manual 43339854431 falhou em `teko-prod` com "Failed query" sem causa — `run-coverage-mark.test.ts`

## 3b. Lacunas por entrada (revisão de 2026-11-12, branch `fix/ingestao-revisao`)

- [x] 3b.1 `gap_entries` (migração `coverage-gap-entries`, com backfill de `gaps` e grant ao `teko_watch`), `covers` no `corpus/watch.yaml` e no `discovered.json`, `addGapEntry`/`summarizeGaps` — `coverage-gaps.test.ts`, `mark-coverage.test.ts`, `test/integration/watch/coverage-watch.test.ts`
- [x] 3b.2 A ingestão limpa só a entrada resolvida por versão nova do documento, criada depois da detecção (M1) — `pg-ingestion-repositories.test.ts`, `test/integration/ingest/ingest-document-version.test.ts`
- [x] 3b.3 A promoção decide a lacuna pela detecção contra o `createdAt` do snapshot (A1) — `test/integration/ingest/snapshot.test.ts`

## 4. Workflow

- [x] 4.1 `source-watch.yml` (cron `0 9 * * *`, `detect` no staging, `mark-coverage` no `corpus-watch`, `ingest` por `workflow_call`, `watch-errors`) — actionlint 1.7.12 e `ci-config.test.sh`
- [x] 4.2 Evento ao Sentry quando houver mudança: fora do escopo da F3: o Sentry chega na F6; o TODO no workflow continua
- [x] 4.3 Primeiro run depois do merge: o agendado de 2026-11-13 não disparou (o GitHub descartou o cron `0 9 * * *`), e o run manual 43462349735 (`workflow_dispatch` no `develop`, ainda em audit) foi verde: 0 mudança, 0 erro; `teko-staging: verified_at=2026-11-13` (2 famílias avançaram, e as demais já estavam em 2026-11-13 pelo ingest 43403700598); `teko-prod` com o aviso esperado de banco sem o schema `corpus`. Harden-runner do `detect`, do `mark-coverage` e do `watch-errors` em `block`, com os hosts observados (GitHub e releases, Actions, npm, Neon só no `mark-coverage` e as páginas do `corpus/watch.yaml`) — `ci-config.test.sh` e actionlint
