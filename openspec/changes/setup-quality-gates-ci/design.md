# Design

## Context

Ver `proposal.md` para a motivação. O repositório é de usuário (sem merge queue), os rulesets
exigem `strict` status checks e os workflows das fases seguintes (e2e, mutação, performance,
evals, release) ainda não existem.

## Goals / Non-Goals

**Goals:**

- Um só check obrigatório (`ci-gate`) que não muda quando workflows novos entram.
- Mesmo comando localmente e no CI (`pnpm lint`, `pnpm spec:validate`, `pnpm check-lockfile`...).
- Workflows endurecidos: SHAs pinados, `permissions: {}` por padrão, harden-runner,
  `persist-credentials: false`, sem `pull_request_target`.

**Non-Goals:**

- Gates de release (`release-gate.yml`) e de deploy.
- Execução de e2e, mutação, carga e evals (fases F4 e F8).

## Decisions

- **`pr-gate.yml` chamando workflows via `workflow_call`, todos sempre executados.** O filtro de
  caminhos acontece dentro dos jobs a partir do job `affected`. Alternativa: `paths` no gatilho;
  descartada porque um workflow que não roda deixa o check obrigatório pendente para sempre.
- **`re-actors/alls-green` como agregador**, com `allowed-skips` explícito. Alternativa: um job
  com `needs` e `if: failure()`; descartada porque trata `cancelled` e `skipped` de forma frágil.
- **CodeQL em workflow próprio**, para que o nome do check (`Analyze (<linguagem>)`) não ganhe o
  prefixo que o `workflow_call` acrescenta.
- **Escopo afetado por `turbo` + `.github/affected-paths.yml`**: o turbo cobre os pacotes JS
  (`affectedUsingTaskInputs`); os globs cobrem o que não é pacote (ingestão Python, corpus,
  prompts).
- **commitlint com `signed-off-by`** além do check `dco`: o hook local antecipa o erro, o check
  do PR é a garantia.
- **Hooks com lefthook** (binário Go via npm, `prepare` instala). O `postinstall` do lefthook fica
  negado em `allowBuilds` (ver ADR 0002). Os comandos chamam `./node_modules/.bin/*` em vez de
  `pnpm exec`, para funcionar sem `pnpm` no PATH (Corepack sem `enable`).
- **knip em dois modos.** O modo padrão cobre o projeto inteiro (com testes); o `--production`
  restrito a `dependencies,unlisted,unresolved,binaries` pega dependência de runtime usada só em
  teste. Alternativa: só o modo padrão; descartada porque ele aceita essa classe de erro.
- **Codecov por OIDC** (`use_oidc: true`, `id-token: write` só no job de cobertura), sem token de
  upload. **SonarQube Cloud pelo CI**, com a análise automática desligada, para que o quality gate
  use a cobertura gerada no próprio job.
- **Badges pelo shields.io em `flat-square`**, inclusive para serviços com badge próprio (Sonar,
  Best Practices, Stryker via endpoint), para manter um só estilo. O Node vem de `engines.node` do
  `package.json` da raiz pelo badge `dynamic/json`, e não de um valor fixo.

## Risks / Trade-offs

- [Workflow novo esquecido no `needs` do `ci-gate`] → o comentário do `pr-gate.yml` descreve os
  três passos; a revisão do CODEOWNER cobre `/.github/`.
- [harden-runner em `audit`] → duas semanas em audit para levantar a allowlist, depois `block`.
- [Meta de 8 minutos] → cache do Turborepo e do pnpm na action `setup`; jobs em paralelo.

## Fontes Context7

| Biblioteca | ID Context7                           | Versão conferida | Tópicos                                                                                         |
| ---------- | ------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| OpenSpec   | `/fission-ai/openspec`                | 1.16.0           | `validate --all --strict --no-interactive` e regras de cenário                                  |
| pnpm       | `/pnpm/pnpm/v12.15.0`                 | 12.x             | settings de supply chain usados pelo job de lockfile e audit                                    |
| Turborepo  | `/vercel/turborepo/v2.11.10`          | 2.11.10          | `turbo run --affected` no pre-push e escopo afetado no job `affected`                           |
| Biome      | `/biomejs/biome` e `/biomejs/website` | 2.6.4            | `biome ci --error-on-warnings`, `check --staged --write` no hook, formatação de Markdown        |
| Stryker    | `/websites/stryker-mutator_io`        | 10.1.1           | reporter `dashboard` com `module` por pacote no monorepo                                        |
| Shields.io | `/badges/shields`                     | serviço atual    | rotas dos badges de CI, CodeQL, Scorecard, Best Practices, Codecov, Sonar e endpoint do Stryker |

As ações do GitHub (checkout, harden-runner, alls-green, CodeQL, dependency-review, osv-scanner,
zizmor, gitleaks, Semgrep, scorecard, codecov) e as ferramentas de lint (knip, sherif,
dependency-cruiser, steiger, commitlint, lefthook) foram conferidas pelos streams que escreveram
os workflows e a configuração da raiz; os IDs que faltam nesta tabela devem ser acrescentados por
esses streams antes do arquivamento (tarefa 3.3).
