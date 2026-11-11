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

| knip | `/websites/knip_dev` | 6.44.1 | padrões `!` de produção em `entry`/`project` por workspace e `--production --include dependencies,unlisted,unresolved,binaries` |
| sherif | sem ID no Context7 (a busca devolve só `/sheriff-arch/sheriff`, outra ferramenta) | 1.13.0 | `lint:monorepo` sem configuração; conferido pelo README do pacote |
| dependency-cruiser | `/sverweij/dependency-cruiser` | 18.7.2 | regras `forbidden` da API hexagonal, `tsPreCompilationDeps`, `enhancedResolveOptions` e `dependencyTypesNot: type-only` |
| Steiger | `/feature-sliced/steiger` | 0.9.0 (plugin 0.8.2) | `fsd.configs.recommended`, `forbidden-imports` desligada em favor de `no-cross-imports` e `no-higher-level-imports`, `import-locality` e `ignores` |
| commitlint | `/conventional-changelog/commitlint` | 21.2.4 | `config-conventional`, `scope-enum` com a lista de escopos e `signed-off-by` |
| Lefthook | `/evilmartians/lefthook` | 2.2.1 | `pre-commit` paralelo com `glob` e `stage_fixed`, `commit-msg` com `{1}` e `pre-push` com `--affected` |
| GitHub Actions | `/websites/github_en_actions` | serviço atual | `workflow_call` com `secrets` explícitos e `permissions` por job; `re-actors/alls-green` (`allowed-skips`) não tem ID e foi conferido pelo README da action |
| zizmor | `/zizmorcore/zizmor` | 1.32.0 (action v0.8.1) | `zizmor-action` com `permissions: {}` no topo, `persist-credentials: false` e anotações sem SARIF |
| Gitleaks | `/gitleaks/gitleaks/v8.30.1` | 8.30.1 | `gitleaks git` com `--log-opts` pela faixa de commits do PR, `--redact` e código de saída 1 com vazamento |

A conferência no fechamento da F1 encontrou uma divergência: o `apps/web/steiger.config.ts` ligava
`no-cross-imports` sem desligar a `forbidden-imports` do `recommended`, e a doc do Steiger manda
trocar a regra agregada pelas duas granulares. A configuração foi corrigida. As demais ações
(checkout, harden-runner, CodeQL, dependency-review, osv-scanner, Semgrep, scorecard, codecov)
são fixadas por SHA e conferidas pelo README de cada uma, sem ID no Context7.
