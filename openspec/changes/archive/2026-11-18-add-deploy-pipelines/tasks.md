# Tasks

## 1. Workflows

- [x] 1.1 `.github/workflows/deploy.yml` (plan, audit, build, neon-rehearsal, deploy; phase deploy e
  redeploy; rollback depois do promote; ponto do system test comentado)
- [x] 1.2 `.github/workflows/release.yml` mínimo (SemVer com pré-release, staging verde, tag pela App)
- [x] 1.3 `.github/workflows/neon-rehearsal.yml` (`workflow_call` e dispatch, `release-rehearsal`,
  branch efêmero apagado sempre, aviso sem segredos)
- [x] 1.4 `.github/scripts/deploy-smoke.sh`, `neon-extensions-check.sh` e `staging-verified.sh`
  (verificar: shellcheck da imagem do actionlint)
- [x] 1.5 `audit.yml` com o nome do workflow no grupo de concurrency; `.github/zizmor.yml` com os
  workflows novos que usam `uses: ./`

## 2. Invariantes

- [x] 2.1 `ci-config.test.sh` cobre os três workflows (permissions vazio, harden-runner em block,
  checkout sem credenciais, timeout, pin por SHA, build sem segredo, ordem do deploy, rollback,
  release pela App, rehearsal apagando o branch) (verificar: `bash .github/scripts/ci-config.test.sh`)
- [x] 2.2 actionlint (Docker `rhysd/actionlint:1.7.12`) sem erros

## 3. Docs

- [x] 3.1 ADR 0038 e o índice das ADRs
- [x] 3.2 Runbooks `docs/runbooks/deploy.md` e `docs/runbooks/rollback.md`; `neon-roles.md` aponta
  para o `deploy.yml`
- [x] 3.3 `docs/architecture/ci-cd-e-ambientes.md` (tabela de workflows e deploy) e
  `infra/vercel/README.md` ("Como o deploy acontece")

## 4. Gates

- [x] 4.1 `pnpm verify:full` verde; mudança arquivada com
  `pnpm exec openspec archive add-deploy-pipelines --yes`
