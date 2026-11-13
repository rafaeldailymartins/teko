# CI/CD, branches e ambientes

## Branches: trunk-based (ADR 0033)

- `main` é o tronco e o branch padrão. **Push em `main` = staging.**
- **Produção sai por tag `v*`**, criada só pela App `teko-release-bot` (ruleset `release-tags`).
- Branches de trabalho saem de `main` com um prefixo permitido: `feature/`, `fix/`, `chore/`,
  `docs/`, `refactor/`, `perf/`, `test/`, `ci/`, `build/` (mais `dependabot/**`).
- PR para `main` com **squash** (título em Conventional Commits, escopo da lista única do
  `pr-title`); merge commit e rebase desligados; auto-merge e exclusão do head branch ligados.
- Commits assinados (SSH) e com DCO (`git commit -s`). Para atualizar a branch de um PR, use
  `gh pr update-branch`: o `dco` só isenta o merge commit feito pelo `web-flow`.

**Rulesets** (só rulesets, sem branch protection clássica):

- **`checks-main`** (alvo `~DEFAULT_BRANCH`, sem bypass): `deletion`, `non_fast_forward`,
  `required_signatures`, PR com squash e resolução de threads, `required_status_checks` sem
  `strict` (desligado em 2026-11-12: o branch do PR não precisa estar atualizado com `main`) com
  `ci-gate`, `pr-title`, `dco`, `Analyze (javascript-typescript)` e `Analyze (python)` (o
  `Analyze (actions)` saiu em 2026-11-13, ADR 0032), e `code_scanning` (CodeQL,
  `high_or_higher`).
- **`review-main`**: PR obrigatório com **0 aprovações** e sem code owner (mantenedor único; assim
  o auto-merge funciona, inclusive no Dependabot). Com um segundo mantenedor, volta para 1
  aprovação + code owners + `dismiss_stale_reviews_on_push`. O check "Code-Review" do Scorecard
  fica em 0 enquanto isso.
- **`release-tags`** (`refs/tags/v*`): criação, alteração e exclusão só pela App.
- **`branch-names`**: só os prefixos acima, `main` e `dependabot/**`.
- **`CODEOWNERS`**: `* @rafaeldailymartins`, com entradas para `.github/`, domínio, migrações,
  evals, specs, `corpus/` e `infra/` (informativo enquanto a revisão de code owner não for exigida).

**Checks.** `ci-gate` (`re-actors/alls-green`, com `!cancelled()`) é o único agregador de PR, no
`pr-gate.yml`, que chama via `workflow_call` os workflows de PR; o job `affected` decide o que roda
e os não afetados terminam `skipped` (permitidos no `allowed-skips`). Fora do agregador:
`Analyze (*)` (workflow próprio, para o nome do check não ganhar prefixo), `pr-title` e `dco`. O
SonarQube Cloud analisa, mas não reprova o `ci-gate`.

**`affected`.** `turbo query affected --packages` para `web`, `api` e `shared`; os grupos de
caminhos de `.github/affected-paths.yml` dão `ingest`, `rag` (inclui
`adapters/out/{reranker,embeddings}/**`), `llm` e `docs` (`docs/**`, `openspec/**`, `*.md`). PR só
de docs roda o mínimo (`spec:validate`, lint de markdown se houver, higiene). Mudança só em
workflow agendado ou de ingestão não marca tudo como afetado.

## Releases (git-cliff + App `teko-release-bot`)

Versão única do produto, SemVer `vX.Y.Z`, sincronizada nos `package.json` e no `pyproject.toml`.

1. `release.yml` em `workflow_dispatch` (input `bump`: auto, patch, minor, major): `git cliff
   --bumped-version`, gera o `CHANGELOG.md` e abre, pela App (commit assinado via
   `createCommitOnBranch`), o PR `chore(release): vX.Y.Z` para `main`.
2. Depois do merge, a App cria a tag `vX.Y.Z` no commit do merge.
3. O push da tag dispara o `release.yml`:
   - job **`release-gate`**: `neon-rehearsal` (environment `release-rehearsal`: branch efêmero do
     `teko-prod`, `drizzle-kit migrate`, checagem de extensões, exclusão do branch), evals completas
     (geração + red team, snapshot travado), e2e, k6 `load`, ZAP baseline, `spec:validate` e
     `staging-verified` (smoke e system test verdes no staging para o mesmo SHA);
   - jobs de produção (environment `production`, revisor obrigatório): build e atestação do
     `.vercel/output`, `drizzle-kit migrate` na produção, release imutável com o tarball, o SBOM e
     a atestação, `promote-corpus`, `vercel deploy --prebuilt` + `promote` e smoke de produção
     (falha → rollback).
4. **Hotfix** é um release patch a partir de `main`. O `prod-vuln-scan` diário (high/critical)
   dispara o mesmo fluxo.

## Dependabot

- `target-branch` = branch padrão, semanal (segunda, 06:00 America/Sao_Paulo), `cooldown` de 7 dias
  (14 em major); grupos por família (prod e dev minor-patch, OTel, Langfuse, TanStack, testing);
  `ignore` de major em `@opentelemetry/*` e `@fastify/otel` até o Langfuse suportar OTel 3.
- Ecossistemas: npm (`/`, `tools/vercel-cli`), `github-actions` (`/` e `.github/actions/*`), `uv`
  (`tools/ingest`), `docker` e `docker-compose`.
- `commit-message` com prefixo `chore` e escopo (`chore(deps): …`, `chore(deps-dev): …`).

## Workflows

Comum a todos: `permissions: {}` no topo, harden-runner como primeiro passo, checkout com
`persist-credentials: false`, `timeout-minutes` em todo job, concurrency com cancelamento em PR e
sem cancelamento em deploy, setup em `.github/actions/setup` (pnpm, Node 24, `--frozen-lockfile`),
cache do Turbo salvo só em push no tronco.

| Workflow           | Gatilho                                            | Conteúdo                                                                                                                         |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pr-gate.yml`      | PR                                                 | `affected` → `ci.yml`, `security.yml`, `perf.yml` (perfil `pr`), `e2e.yml` (F4), `evals.yml` (perfil `pr`, F8) → `ci-gate`       |
| `ci.yml`           | `workflow_call`; push no tronco                    | camada rápida, integração, build e guards, `migration-guard`, Python, retrieval evals (se `rag`/`ingest`), Sonar informativo     |
| `codeql.yml`       | PR, push no tronco, semanal                        | `Analyze (*)`                                                                                                                    |
| `pr-hygiene.yml`   | PR                                                 | `pr-title`, `dco`, labeler (o `gitflow-guard` saiu com o trunk-based)                                                            |
| `security.yml`     | `workflow_call`; push; agendado                    | Semgrep, gitleaks, zizmor, dependency-review (PR); `pnpm audit` e osv-scanner no `audit.yml`, fora do PR                         |
| `scorecard.yml`    | push no tronco, semanal                            | `publish_results: true`                                                                                                          |
| `mutation.yml`     | nightly                                            | Stryker em `apps/api` e `packages/shared`, só se houver commit novo desde o último run verde                                     |
| `perf.yml`         | `workflow_call` (perfil `pr`); pré-release         | `sql-perf` (gate), bench e autocannon (informativos), k6 `smoke` (PR) e `load` (pré-release)                                     |
| `e2e.yml`          | `workflow_call` (PR e release); nightly            | stack de CI, Playwright Chromium + mobile, axe (F4/F5)                                                                           |
| `evals.yml`        | `workflow_call`; nightly; semanal                  | `generation` e `redteam` (environment `evals`, F8)                                                                               |
| `ingest.yml`       | dispatch; `workflow_call` do `source-watch`        | discover → extract → load → corpus-eval → lock-pr; modo `eval-only` ([ingestão](ingestao-e-avaliacao.md#ingestyml))              |
| `source-watch.yml` | cron diário                                        | `detect` (environment `staging`) e `mark-coverage` (environment `corpus-watch`)                                                  |
| deploy (F7)        | push no tronco → staging; `release.yml` → produção | um só `.vercel/output` (estático + Function) por ambiente: build, tarball, scan, attest, migrate, env sync, deploy, smoke        |
| `smoke.yml`        | `workflow_call` (input `env`)                      | smoke + rollback                                                                                                                 |
| `release.yml`      | dispatch; push de tag `v*`                         | PR de release; `release-gate` e jobs de produção (F9)                                                                            |
| `ops.yml`          | cron diário e semanal (environment `ops`)          | cotas e CU-h, expiração de tokens, Grafana e modelos do Langfuse as code, `vercel-usage`, `prod-vuln-scan`, `weekly-maintenance` |

Os workflows `spike-*.yml` da F1 saem (ADR 0032).

## Environments e segredos

| Environment         | Ref permitido              | Proteção             | Segredos / vars                                                                                                                                                                                                                     |
| ------------------- | -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging`           | `main`                     | nenhuma              | `VERCEL_TOKEN` (90 dias), `VERCEL_AUTOMATION_BYPASS_SECRET`, vars `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` (`tekoia-staging`), `NEON_STAGING_MIGRATE_URL`, `NEON_API_KEY_STAGING`, `CF_ACCOUNT_ID`/`CF_AI_TOKEN`, passkey do system test |
| `production`        | tag `v*`                   | revisor (mantenedor) | equivalentes de produção (`VERCEL_TOKEN` próprio, bypass, `VERCEL_PROJECT_ID` do `tekoia`), `NEON_PROD_MIGRATE_URL`                                                                                                                 |
| `maintenance`       | `main`                     | nenhuma              | `NEON_PROD_APP_URL` e `NEON_STAGING_APP_URL` (`teko_app`)                                                                                                                                                                           |
| `release-rehearsal` | tag `v*`                   | nenhuma              | `NEON_API_KEY_PROD` (project-scoped), `NEON_PROD_PROJECT_ID`                                                                                                                                                                        |
| `evals`             | todas (forks sem segredos) | nenhuma              | `GEMINI_API_KEY_CI`, `GROQ_API_KEY_CI` (projeto Google de CI, sem billing)                                                                                                                                                          |
| `corpus-watch`      | `main`                     | nenhuma              | `NEON_PROD_WATCH_URL` e `NEON_STAGING_WATCH_URL` (`teko_watch`)                                                                                                                                                                     |
| `ops`               | `main`                     | nenhuma              | API keys do Neon, `GRAFANA_SA_TOKEN`, chaves de admin do Langfuse, `VERCEL_USAGE_TOKEN` (distinto dos de deploy), vars dos projetos e das expirações                                                                                |

- Os artefatos de ingestão usam o `GITHUB_TOKEN` com `contents: write` só nos jobs que gravam
  (ADR 0030); não há PAT de terceiros no environment `staging`.
- No nível do repositório: `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`, var `RELEASE_APP_CLIENT_ID`,
  `STRYKER_DASHBOARD_API_KEY`, `SONAR_TOKEN` (também como segredo do Dependabot).
- Chaves de LLM, Langfuse de runtime, Better Auth e OTLP do Grafana ficam **só** nas env vars
  Sensitive de cada projeto Vercel. No Hobby, todo token da Vercel tem escopo da conta inteira; por
  isso cada uso tem um token próprio e o `ops` roda com harden-runner em `block`.
- A regra de branch de um environment, num `pull_request`, é avaliada contra `refs/pull/N/merge`
  (ADR 0024): nenhum environment com segredo sensível é usado em PR.
- Quem cadastra segredos é o mantenedor (`gh secret set NOME --env <env>`); segredos nunca passam
  pelo chat nem pelo código.

## Deploy e rollback

Um deploy publica, de uma vez, o estático e a Function do mesmo commit (ADR 0029):

1. `pnpm install --frozen-lockfile`, `pnpm audit --prod` e osv-scanner no commit exato;
2. build da API (tsdown) e do web (export), `pnpm deploy --prod` da API e
   `scripts/build-vercel-output.ts` (sem `vercel pull` nem `vercel build`, ADR 0017); nenhum segredo
   entra no build;
3. `scripts/pack-vercel-output.ts`: tarball determinístico, sem `.vercel/.env*` nem
   `project.json`, gitleaks nele e sha256;
4. SBOM (syft) e Grype; `actions/attest` (provenance e SBOM); o tarball sobe como artifact
   (staging) ou asset do release (produção);
5. `drizzle-kit migrate` na URL direta, conferindo `extversion` e `pg_settings`;
6. sync da Config de `infra/vercel/env.<ambiente>.json` (falha se faltar Sensitive);
7. `gh attestation verify` do tarball e `vercel deploy --prebuilt --prod --skip-domain
   --archive=tgz --meta artifactSha256=<sha256> --meta gitSha=<sha>`;
8. smoke da URL única com `vercel curl --protection-bypass` (`/healthz` com o `gitSha`);
9. `vercel promote`, e o smoke de produção no domínio canônico.

**O que garante que produção roda o código do CI:** o `--prebuilt` envia exatamente o output
atestado, com a atestação verificada antes, a `meta.artifactSha256` na deployment e o
`VERCEL_TOKEN` restrito aos environments (a Vercel não tem OIDC para deploy nem expõe digest dos
arquivos).

**Rollback.** `vercel rollback` (no Hobby, só a deployment imediatamente anterior; depois, a
atribuição automática do domínio fica desligada até um `vercel promote` explícito) ou `vercel
promote` de uma deployment de produção mais antiga. A âncora de longo prazo é o tarball atestado
do release (`gh attestation verify` + `vercel deploy --prebuilt`). Env vars não voltam junto. O
corpus tem rollback próprio ([ingestão](ingestao-e-avaliacao.md#snapshot-promoção-e-rollback)).

**Smoke** (cerca de 15 requests, sem LLM): `GET /` (redirect por idioma), `/pt-BR/` e `/en/` com
headers; `/healthz` com o `gitSha` esperado; `GET /api/v1/coverage` (1 leitura no DB, `no-store`,
sem cache HIT); stream sem sessão → 401 e com `Origin` errado → 403; WAF: `GET /api/qualquer-coisa`
→ 403; domínio antigo `teko-api*.vercel.app` → 308 para o canônico; URL única sem bypass não chega
à API.

**System test** (staging): login por passkey, 1 pergunta de um pool de 30 escolhida por
`run_number` (stream até o `finish`), repetição para conferir cache hit, recusa fora da cobertura e
troca de locale; no máximo 2 gerações por run.
