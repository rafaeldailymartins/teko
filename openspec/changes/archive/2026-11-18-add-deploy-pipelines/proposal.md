# Proposal

## Why

O roteiro da F7 pede o deploy único do `.vercel/output` (estático e Function) com tarball atestado,
migrações, sync de env, WAF, smoke, `promote` e rollback, em staging a cada push em `main` e em
produção por tag `v*` (ADR 0033). Hoje nada disso roda: o spike da F1 provou as peças e saiu do
repositório, e o `release.yml` completo (com o `release-gate`) só chega na F9. Falta também o
ensaio das migrações num branch efêmero do banco de produção.

## What Changes

- `.github/workflows/deploy.yml`: push em `main` → staging; tag `v*` → produção; dispatch com
  `phase: deploy|redeploy`. Jobs `plan` → `audit` → `build` (sem segredo: build, inject, pack,
  SBOM, Grype, atestações) → `neon-rehearsal` (produção) → `deploy` (verify, migrate com checagem
  de extensões, env sync, WAF, source maps, `vercel deploy --prebuilt`, smoke, `promote`, smoke
  canônico, rollback em falha depois do promote). Concurrency por ambiente sem cancelamento.
- `.github/workflows/release.yml` mínimo (ADR 0038): dispatch com a versão SemVer, confere o
  staging verde do SHA de `main` e cria a tag pela App `teko-release-bot`.
- `.github/workflows/neon-rehearsal.yml` reutilizável: branch efêmero do `teko-prod`, migrate,
  extensões e exclusão sempre; sem segredos, aviso e verde.
- `.github/scripts/`: `deploy-smoke.sh` (chama o `scripts/smoke.ts` ou faz o smoke mínimo do
  `/healthz`), `neon-extensions-check.sh` e `staging-verified.sh`.
- `audit.yml`: grupo de concurrency com o nome do workflow que chama.
- `ci-config.test.sh` cobre os três workflows; runbooks `deploy.md` e `rollback.md`; ADR 0038;
  `ci-cd-e-ambientes.md` e `infra/vercel/README.md` atualizados.

## Capabilities

### New Capabilities

Nenhuma (os requisitos entram na capability `deployment`, criada por `add-vercel-deployment`).

### Modified Capabilities

- `deployment`: pipeline de deploy, release mínimo e ensaio das migrações.

## Impact

- `.github/workflows/{deploy,release,neon-rehearsal,audit}.yml`, `.github/zizmor.yml`,
  `.github/scripts/*`.
- `docs/runbooks/deploy.md`, `docs/runbooks/rollback.md`, `docs/runbooks/neon-roles.md`,
  `docs/adr/0038-release-minimo-da-f7.md`, `docs/adr/README.md`,
  `docs/architecture/ci-cd-e-ambientes.md`, `infra/vercel/README.md`.
- Nenhum segredo novo: usa os dos environments `staging`, `production` e `release-rehearsal` e os
  da App no repositório.

Fase: F7. ADRs: 0017, 0029, 0033 e a nova 0038. O smoke completo (`scripts/smoke.ts`) e o system
test são da mudança `add-smoke-tests`; o guarda de uso, da `add-usage-guard`.
