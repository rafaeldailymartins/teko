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

## 4. Workflow

- [x] 4.1 `source-watch.yml` (cron `0 9 * * *`, `detect` no staging, `mark-coverage` no `corpus-watch`, `ingest` por `workflow_call`, `watch-errors`) — actionlint 1.7.12 e `ci-config.test.sh`
- [ ] 4.2 Evento ao Sentry quando houver mudança (F6, sem DSN ainda; TODO no workflow)
- [ ] 4.3 Primeiro run agendado depois do merge: conferir o `verified_at` dos dois bancos e passar o harden-runner do `source-watch.yml` para `block` com os hosts observados
