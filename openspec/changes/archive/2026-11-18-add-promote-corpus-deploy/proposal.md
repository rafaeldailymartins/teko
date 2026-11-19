# Proposal

## Why

O primeiro deploy de produção da F7 (tag `v0.1.0-rc.2`, run 44422494861) passou no
`neon-rehearsal` e nas migrações, mas o smoke da URL da deployment reprovou: o `GET
/api/v1/coverage` respondeu 200 sem `corpusVersion` nem famílias, porque o banco de produção não tem
corpus. Pelo desenho (ADR 0025), a produção só recebe o corpus pelo snapshot promovido, e a ADR 0038
tinha deixado o `promote-corpus` para a F9. O mantenedor decidiu antecipá-lo para a F7.

## What Changes

- **`cli snapshot promote --lock <corpus.lock.json>`**: promove o snapshot do lock, conferindo o
  sha256 do `manifest.json` do store contra o `manifestSha256` e a versão contra a do lock. Com o
  destino na versão do lock (`up-to-date`) ou à frente dela (`target-newer`), não escreve nada; nunca
  faz rollback. Caso de uso novo `PromoteLockedSnapshot`, sobre as mesmas checagens e a mesma
  escrita do `PromoteSnapshot`.
- **A CLI do snapshot só lê `DATABASE_URL` e o store** (`loadSnapshotEnv`, `createSnapshotContainer`),
  sem o schema completo da API: o snapshot não calcula embeddings, e o environment `production` não
  tem as credenciais do Workers AI.
- **`deploy.yml`**: passo `promote-corpus` no job `deploy`, só na produção e na `phase: deploy`,
  depois das migrações e antes do env sync e do `vercel deploy`; recusa vira `::error` e para o job,
  produção à frente do lock vira `::warning`.
- `ci-config.test.sh`: ordem, só produção, o lock e os segredos só no `env` do passo.

## Capabilities

### New Capabilities

- nenhuma.

### Modified Capabilities

- `deployment`: requisito novo "Corpus da produção promovido no deploy".
- `embedding-pipeline`: requisito novo "Promoção pelo lock, idempotente".

## Impact

- `apps/api`: `promote-snapshot.ts`, `snapshot.ts` (CLI), `cli.ts`, `composition-root.ts`,
  `container.ts`, `config/env.ts` e testes unitários.
- `.github/workflows/deploy.yml`, `.github/workflows/ingest.yml` (texto do resumo) e
  `.github/scripts/ci-config.test.sh`.
- Docs: ADR 0038 (revisão), `ci-cd-e-ambientes.md`, `ingestao-e-avaliacao.md`, runbooks `deploy.md`
  e `rollback-corpus.md`, `roadmap.md` e `status.md`.
- Operação: o lock atual (versão 14) foi exportado antes das migrações novas; o mantenedor reexporta
  o snapshot no staging e faz o merge do PR do lock antes do próximo release.
- Fase: F7 (bloqueia o primeiro deploy de produção).
