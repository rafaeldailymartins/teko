# Proposal

## Why

No exercício de rollback da produção da F7 (2026-11-18), o `vercel rollback` não voltou para a
deployment que estava no ar: ele escolhe a deployment de produção criada antes da atual, e uma
deployment que parou no smoke (`--prod --skip-domain`, nunca promovida) também conta. O rollback
automático do `deploy.yml` usa o mesmo comando, então uma falha depois do promote podia levar o
domínio a uma deployment que nunca passou no smoke. O DoD da F7 também pede um rollback exercitado
com falha simulada, e não havia como simular.

## What Changes

- Antes do `vercel promote`, o job `deploy` lê a deployment que está no domínio
  (`targets.production`). Na falha depois do promote, ele a promove de novo e confere o `gitSha` do
  `/healthz` do domínio; só sem deployment anterior conhecida cai no `vercel rollback`.
- Input `simulate_failure` no dispatch do `deploy.yml`: força uma falha depois do smoke canônico,
  para exercitar o rollback. Só no staging; a produção recusa.
- `ci-config.test.sh` confere a ordem (leitura antes do promote), o alvo do rollback e a restrição
  do exercício ao staging.
- Docs: runbooks de rollback e deploy, `ci-cd-e-ambientes.md`.

## Capabilities

### Modified Capabilities

- `deployment`: o requisito "Rollback automático depois do promote" passa a promover a deployment
  que estava no domínio e a conferir o `gitSha`, e ganha o cenário do exercício.

## Impact

- `.github/workflows/deploy.yml` e `.github/scripts/ci-config.test.sh`.
- `docs/runbooks/rollback.md`, `docs/runbooks/deploy.md`, `docs/architecture/ci-cd-e-ambientes.md`.
- Fase: F7 (DoD de rollback).
