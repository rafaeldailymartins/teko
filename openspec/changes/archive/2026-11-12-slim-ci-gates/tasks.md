# Tasks

## 1. Gates fora do caminho do merge

- [x] 1.1 `mutation.yml` só com `schedule` e `workflow_dispatch`, job `changes` pulando sem commit novo; `pr-gate.yml` sem o job `mutation` (verificar: `ci-config.test.sh`)
- [x] 1.2 `audit.yml` (push, diário, dispatch, `workflow_call`); job `audit` fora do `ci.yml`; `pnpm audit signatures` no `lint` (verificar: `ci-config.test.sh`)
- [x] 1.3 `sonar.yml` informativo (`continue-on-error`, sem `qualitygate.wait`), chamado pelo `pr-gate.yml` fora dos `needs` do `ci-gate` e pelo `ci.yml` em push para develop; Codecov removido (verificar: `ci-config.test.sh`, actionlint)
- [x] 1.4 `ci-gate` com `!cancelled()`, `needs` em `affected`, `ci`, `security`, `perf`, só o `perf` podendo pular (verificar: `ci-config.test.sh`)

## 2. Ferramentas que saem

- [x] 2.1 `turbo boundaries` e as tags dos pacotes (verificar: `pnpm knip`, `pnpm exec turbo run typecheck`)
- [x] 2.2 Steiger, `lint:fsd` e `trustPolicyExclude: chokidar@4.0.3` (verificar: `pnpm install` e `pnpm knip`)
- [x] 2.3 Hook `commit-msg` e commitlint; `.github/commit-types.json` lido pelo `pr-title` (verificar: actionlint)
- [x] 2.4 `pip-audit` (verificar: `uv.lock` só com remoções)
- [x] 2.5 `spike-*.yml` e as exceções no `.github/zizmor.yml` (verificar: zizmor sem achados)

## 3. Escopo e verificação local

- [x] 3.1 Só `ci.yml`, `pr-gate.yml` e `perf.yml` marcam tudo; grupo `docs` e chave `code`; `lint` reduzido sem código (verificar: `affected.test.sh`, `ci-config.test.sh`)
- [x] 3.2 `pnpm verify`, `pnpm verify:full` e o pre-push com a camada rápida afetada (verificar: `pnpm verify`)
- [x] 3.3 `ci-config.test.sh` sem as checagens que o zizmor cobre; CODEOWNERS corrigido

## 4. Documentação

- [x] 4.1 ADR 0032, adendo da ADR 0002, CONTRIBUTING e README
