# Proposal

## Why

Com um mantenedor só, a revisão humana não basta: os gates de qualidade e segurança precisam ser
automáticos, iguais localmente e no CI, e reunidos num único check obrigatório para que os
rulesets não dependam da lista de workflows de cada fase (F1 do roteiro).

## What Changes

- Hooks locais (lefthook): Biome, gitleaks, validação OpenSpec e guarda de lockfile no commit;
  commitlint (Conventional Commits + DCO) na mensagem; typecheck e testes unitários afetados no push.
- `pr-gate.yml` com o job `affected` (escopo pelo `turbo` e por `.github/affected-paths.yml`) e o
  agregador `ci-gate` (`re-actors/alls-green`), único check de PR exigido pelos rulesets.
- `ci.yml` (lint, lockfile, sherif, knip, OpenSpec, typecheck, dependency-cruiser, steiger, testes
  unitários e de integração, build, `pnpm audit`, Python), `security.yml` (gitleaks, zizmor,
  osv-scanner, Semgrep, dependency-review), `codeql.yml`, `pr-hygiene.yml` (`pr-title`,
  `gitflow-guard`, `dco`) e `scorecard.yml`.
- Serviços de qualidade sem segredo de longa duração sempre que possível: Codecov por OIDC
  (`use_oidc: true`), Socket.dev como GitHub App, SonarQube Cloud com análise pelo CI (segredo
  `SONAR_TOKEN`, variáveis `SONAR_ORGANIZATION` e `SONAR_PROJECT_KEY`; análise automática
  desligada), Stryker Dashboard (`STRYKER_DASHBOARD_API_KEY`, um `module` por pacote) e OpenSSF
  Best Practices (projeto 16550, variável `OPENSSF_BP_PROJECT_ID`).
- Linha de badges `flat-square` nos READMEs provisórios, com esses serviços.
- `pnpm knip` em dois modos e hooks pelo `./node_modules/.bin`.
- Fora de escopo: `e2e.yml` (F4), `mutation.yml`, `perf.yml` e `evals.yml` (F8), `deploy-api.yml`
  (F7), `release-gate.yml` (F9). Cada um entra no `ci-gate` na fase que o cria.

## Capabilities

### New Capabilities

- `quality-gates`: verificações automáticas que uma mudança precisa passar, localmente e no PR,
  antes de chegar a `develop` ou `main`.

### Modified Capabilities

Nenhuma.

## Impact

- `.github/workflows/`, `.github/actions/setup/`, `.github/scripts/affected.sh`,
  `.github/affected-paths.yml`, `.github/dependabot.yml`, `.github/labeler.yml`,
  `.github/pull_request_template.md`, `lefthook.yml`, `commitlint.config.mjs`, `knip.json`,
  `package.json` (script `knip`), `README.md` e `README.pt-BR.md` (badges).
- Rulesets `checks-main` e `checks-develop` passam a exigir `ci-gate`, `Analyze (...)`,
  `pr-title`, `gitflow-guard` e `dco`. O SonarQube Cloud entra pelo `ci-gate`: o job `sonar` espera
  o quality gate (`sonar.qualitygate.wait=true`) e reprova o gate. O check da App ("SonarQube Cloud
  Code Analysis") NÃO é obrigatório, porque nunca aparece em PRs do Dependabot nem de forks.
