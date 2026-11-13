# Proposal

## Why

O mantenedor aprovou o trunk-based (ADR 0033), e em 2026-11-13 os rulesets, os environments e o
branch padrão foram trocados: `develop` foi renomeado para `main`, que passa a ser o tronco (push =
staging), e o `gitflow-guard` deixou de ser exigido. Os requisitos de `quality-gates` e
`ingestion-workflow` ainda citam `develop` e o fluxo `release/*`/`hotfix/*`.

## What Changes

- Os requisitos passam a citar `main` como tronco: PRs, push, auditoria, mutação noturna,
  `migration-guard`, PR do lock, modo `eval-only` e histórico do `corpus-eval`.
- Sai o requisito "Fluxo Git Flow verificado" (PR para `main` só de `release/vX.Y.Z` ou
  `hotfix/vX.Y.Z`); a parte do DCO continua num requisito próprio.
- No código: gatilhos `push` em `main`, `gitflow-guard` fora do `pr-hygiene.yml`,
  `target-branch: main` no `dependabot.yml`, `TURBO_SCM_BASE: origin/main` no lefthook,
  `vcs.defaultBranch` do Biome, scripts de teste do CI, badges e documentação.
- O `lock-pr` do `ingest.yml` (modo `eval-only`) aceita artifacts `corpus-lock` de runs com
  `head_branch` `main` ou `develop`, para não perder os exportados antes do rename (90 dias).

## Capabilities

### Modified Capabilities

- `quality-gates`: tronco `main`; o `gitflow-guard` sai, o DCO fica.
- `ingestion-workflow`: o PR do lock, o `eval-only` e o histórico usam `main`.

## Fora de escopo

- Rulesets, environments e o rename do branch: já feitos (ADR 0033, seção "Transição").
- Renomear o branch principal no SonarQube Cloud (pela interface, com o mantenedor).
- O `release.yml` com o `release-gate` como job (F9).

Fase: transição antes da F4. ADR afetada: 0033.

## Impact

- `.github/workflows/{audit,ci,codeql,corpus-eval-label,ingest,mutation,pr-gate,pr-hygiene,scorecard,security,sonar}.yml`,
  `.github/actions/setup/action.yml`, `.github/dependabot.yml`, `.github/CODEOWNERS`,
  `.github/scripts/{affected.test.sh,ci-config.test.sh,migration-guard.sh}`, `biome.json`,
  `lefthook.yml`, `sonar-project.properties`, `openspec/config.yaml`.
- READMEs, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`, `docs/` e `infra/vercel/README.md`.
