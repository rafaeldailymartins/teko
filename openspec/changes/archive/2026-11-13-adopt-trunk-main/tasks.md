# Tasks

## 1. Workflows e configuração

- [x] 1.1 Gatilhos `push`/`pull_request` em `main` e refs `develop` → `main` nos workflows, na action `setup`, no `biome.json` e no `lefthook.yml` (verificar: actionlint, `ci-config.test.sh`)
- [x] 1.2 `gitflow-guard` fora do `pr-hygiene.yml` (verificar: actionlint)
- [x] 1.3 `target-branch: main` em todas as entradas do `dependabot.yml`, sem tocar em `prefix-development` nem `dependency-type: development`
- [x] 1.4 `lock-pr` do `ingest.yml` aceita `head_branch` `main` e `develop` nos artifacts `corpus-lock` (verificar: actionlint, `ci-config.test.sh`)
- [x] 1.5 `affected.test.sh`, `migration-guard.sh` e `ci-config.test.sh` com `main` (verificar: os três testes de shell)

## 2. Documentação

- [x] 2.1 Badges dos READMEs, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`, `CODEOWNERS`, `docs/` e `infra/vercel/README.md` com `main` como tronco
- [x] 2.2 ADR 0033: `strict` fora da lista "Ficam" e passos da transição registrados como executados em 2026-11-13; `docs/status.md` só com a pendência do SonarQube Cloud
