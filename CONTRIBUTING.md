# Contributing to Tekó

Thanks for helping. This guide covers the local setup, the branch and commit rules, the OpenSpec
workflow and the quality gates every change must pass. Security problems follow
[SECURITY.md](SECURITY.md), never a public issue. Everyone follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

> Code identifiers are in English. Code comments, specs, ADRs and most internal docs are in
> Brazilian Portuguese; the public-facing files (this guide, `SECURITY.md`, `README.md`) are in
> English.

## Local setup

### Prerequisites

| Tool    | Version                             | Notes                                                          |
| ------- | ----------------------------------- | -------------------------------------------------------------- |
| Node.js | `>=24.12.0 <25` (`.nvmrc`: 24)      | Root scripts run as TypeScript through Node's type stripping   |
| pnpm    | 12.18.0, pinned by `packageManager` | Through Corepack only (see below); never install pnpm globally |
| Docker  | Engine with Compose v2              | Local Postgres (pgvector) and the signed dev proxy             |
| uv      | 0.13.x (CI pins 0.13.7)             | Only for the Python ingestion tool (`tools/ingest`)            |
| Git     | with SSH commit signing configured  | See [Commits](#commits)                                        |

All commands in this repository are POSIX. On **Windows, run them in Git Bash**.

pnpm comes from Corepack, at the exact version in `packageManager`. Either run
`corepack enable` once per machine (it puts a `pnpm` shim on your PATH), or, if Corepack cannot
write to the Node.js directory (common on Windows without admin rights), skip it and prefix every
command with `corepack`: `corepack pnpm install --frozen-lockfile`, `corepack pnpm test` and so
on. Both forms are equivalent; the rest of this guide writes plain `pnpm`.

### First run

```bash
corepack enable          # once per machine; or use "corepack pnpm ..." everywhere instead
pnpm install --frozen-lockfile; echo "exit=$?"   # also installs the git hooks (lefthook install)
pnpm dev:secrets; echo "exit=$?"                 # writes apps/api/.env and infra/local/.env
docker compose -f infra/local/compose.yaml up -d --wait; echo "exit=$?"
```

- `pnpm dev:secrets` generates local-only secrets (dev proxy JWS secret, Better Auth secret,
  database and Langfuse passwords) into git-ignored `.env` files. It never overwrites an existing
  secret and never prints values. The signed dev token `DEV_STATIC_JWS` lasts 7 days: run the
  command again when it expires and recreate the proxy with `docker compose ... up -d`.
- The local stack binds only to `127.0.0.1`: Postgres 18 + pgvector on `5432` (change
  `TEKO_PG_PORT` in `infra/local/.env` **before** the first `pnpm dev:secrets` if that port is
  taken) and the signed dev proxy on `8787`, which simulates the Netlify signed proxy in front of
  the API.
- Optional local Langfuse (UI on `http://localhost:3100`, user `dev@teko.localhost`, password in
  `infra/local/.env`):
  `docker compose -f infra/local/compose.yaml --profile langfuse up -d --wait`.
- Long-running processes (`pnpm dev`) go in a separate terminal.

### Long command output (`TEKO_TMP`)

Long output (tests, lint, builds, logs) goes to a file in a session temp directory **outside the
repository**, and then you filter the file. Always print the exit code. Never pipe to `head`,
`tail` or `tee`: the pipe hides the command's exit status, so a red suite looks green.

Bash, zsh, Git Bash:

```bash
TEKO_TMP="$(mktemp -d)"; echo "TEKO_TMP=$TEKO_TMP"
pnpm test > "$TEKO_TMP/teko-tests.log" 2>&1; echo "exit=$?"
grep -anE "FAIL|failed|Error" "$TEKO_TMP/teko-tests.log"; echo "grep-exit=$?"
```

PowerShell:

```powershell
$TEKO_TMP = Join-Path $env:TEMP ('teko-' + [guid]::NewGuid()); New-Item -ItemType Directory $TEKO_TMP | Out-Null
pnpm test *> "$TEKO_TMP/teko-tests.log"; "exit=$LASTEXITCODE"
Select-String -Path "$TEKO_TMP/teko-tests.log" -Pattern 'FAIL|failed|Error'
```

Do not rely on `$TMPDIR` without a fallback and never write logs inside the repository.

## Branches (Git Flow)

- `develop` is the default branch and maps to **staging**. `main` maps to **production**.
- Work branches start from `develop` and use one of these prefixes: `feature/`, `fix/`, `chore/`,
  `docs/`, `refactor/`, `perf/`, `test/`, `ci/`, `build/`. Releases and hotfixes use
  `release/vX.Y.Z` and `hotfix/vX.Y.Z`. Any other name is rejected by the repository rules.
- Locally, git-flow-next 2.1.x is recommended but optional.

| Source → target                     | Merge method                                           |
| ----------------------------------- | ------------------------------------------------------ |
| `feature/*`, `fix/*`, … → `develop` | **squash**; the PR title must be a Conventional Commit |
| `release/*`, `hotfix/*` → `main`    | merge commit                                           |
| `main` → `develop` (back-merge)     | merge commit, auto-merge                               |

Rebase merging is disabled and linear history is not required. Only `release/vX.Y.Z` and
`hotfix/vX.Y.Z` branches may open PRs into `main`. Direct pushes to `main` and `develop` are
impossible.

## Commits

### Conventional Commits

Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/)
and are checked by commitlint (`commitlint.config.mjs`). Allowed scopes, the single source of
truth being `commitlint.config.mjs`:

`web`, `api`, `shared`, `ingest`, `retrieval`, `eval`, `obs`, `i18n`, `auth`, `db`, `ci`, `deps`,
`deps-dev` (used by Dependabot for development dependencies), `release`, `specs`, `docs`, `infra`

Examples: `feat(retrieval): filter chunks by validity range`, `fix(api): reject replayed tickets`,
`docs(specs): add hybrid-search scenarios`. The changelog is generated from these messages by
git-cliff.

### DCO sign-off and signatures

Every human commit must carry a
[Developer Certificate of Origin](https://developercertificate.org/) sign-off, added by
`git commit -s`:

```text
Signed-off-by: Your Name <you@example.com>
```

commitlint enforces it locally and the `dco` check enforces it on every PR. Commits must also be
**signed** (SSH signing is recommended: `git config gpg.format ssh`,
`git config user.signingkey <path-to-public-key>`, `git config commit.gpgsign true`), because the
protected branches require signed commits.

## OpenSpec workflow

Behavior changes are specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) before they
are implemented. Specs live in `openspec/specs/`, in-flight changes in `openspec/changes/`.

1. **Propose.** On `feature/<id>`, create the change with `/opsx:propose` (Claude Code) or
   `pnpm exec openspec new change <id>`. It holds `proposal.md`, `design.md`, `tasks.md` and spec
   deltas with `#### Scenario:` blocks written as WHEN/THEN.
2. **Fontes Context7 (mandatory).** Before writing code, configuration or workflows that depend
   on a library, framework, CLI or service, read its current documentation through the Context7
   MCP (`resolve-library-id` → `query-docs`). The change's `design.md` must have a
   **"Fontes Context7"** section listing every library ID consulted, the version checked and the
   topics read. If the documentation contradicts the plan or an ADR, fix the plan/ADR in the same
   PR.
3. **Implement** with `/opsx:apply`, ticking `tasks.md` as you go. Scenarios become acceptance
   tests tagged `@spec:*`.
4. **Archive** in the same PR: `pnpm exec openspec archive <id> --yes`.
5. **Validate**: `pnpm spec:validate` (`openspec validate --all --strict --no-interactive`) runs in
   the pre-commit hook and in CI.

Set `OPENSPEC_TELEMETRY=0` if you do not want OpenSpec to send anonymous usage data.

## Dependencies

The supply-chain rules are documented in
[ADR 0002](docs/adr/0002-supply-chain-pnpm.md). In short:

- every version lives in the pnpm **catalog** (`pnpm-workspace.yaml`); `catalogMode: strict`
  rejects anything else;
- a version must be at least **7 days old** (`minimumReleaseAge`), and its provenance must not be
  weaker than earlier releases (`trustPolicy: no-downgrade`);
- dependency build scripts are denied unless explicitly reviewed in `allowBuilds`;
- `devEngines.packageManager` and `configDependencies` are forbidden (`pnpm check-lockfile`);
- the application workspace has **no** exceptions for Vercel packages: `@vercel/functions` is
  pinned to 3.7.6, the last release with SLSA provenance. Do not bump it until Vercel publishes
  with provenance again.

### Deploy CLIs (`tools/vercel-cli`, `tools/netlify-cli`)

The Vercel CLI and the Netlify CLI live in `tools/vercel-cli` and `tools/netlify-cli`, separate pnpm
projects (`packages: []`) with their own lockfiles. They hold the only provenance exceptions in the
repository (`vercel` and `@vercel/*` stopped shipping SLSA provenance in August 2026, and two exact
versions of `@netlify/serverless-functions-api`; see ADR 0002). They are **not** part of the
workspace, are not installed by the root `pnpm install`, and only run in the deploy jobs of GitHub
Actions:

```bash
corepack pnpm --dir tools/vercel-cli install --frozen-lockfile
corepack pnpm --dir tools/vercel-cli exec vercel --version
corepack pnpm --dir tools/netlify-cli install --frozen-lockfile
corepack pnpm --dir tools/netlify-cli exec netlify --version
```

You do not need them locally: deploys happen only from CI (the API as a Build Output API assembled
from the tsdown bundle and deployed with `vercel deploy --prebuilt`, ADR 0017; the web with
`netlify deploy --build`). Never add `vercel`, `@vercel/*` or Netlify CLI exceptions to the root
`pnpm-workspace.yaml`.

### Python (`tools/ingest`)

The Python side follows the same 7-day rule: `tools/ingest/pyproject.toml` sets
`exclude-newer = "7 days"` under `[tool.uv]`, so `uv lock` ignores releases younger than a week.
Always commit `uv.lock` and use `--frozen` (`uv sync --frozen`, `uv run --frozen ...`). An
exception uses `exclude-newer-package` with the exact version and is justified in ADR 0002.

## Quality gates

Run these before opening a PR (CI runs all of them again):

| Command                      | What it checks                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| `pnpm lint`                  | Biome lint + format (`--error-on-warnings`)                             |
| `pnpm typecheck`             | TypeScript in every package                                             |
| `pnpm test`                  | unit + integration tests                                                |
| `pnpm knip`                  | unused files, exports and dependencies (two passes, see below)          |
| `pnpm dup`                   | copy-paste detection (jscpd)                                            |
| `pnpm type-coverage`         | type coverage ≥ 99% (`--strict`) in every package                       |
| `pnpm lint:monorepo`         | workspace consistency (sherif)                                          |
| `pnpm lint:deps`             | architecture boundaries (dependency-cruiser)                            |
| `pnpm exec turbo boundaries` | package boundaries (imports outside the package, undeclared deps, tags) |
| `pnpm spec:validate`         | OpenSpec strict validation                                              |
| `pnpm check-lockfile`        | single-document `pnpm-lock.yaml`                                        |

CI also runs two shell test suites over its own configuration: `.github/scripts/affected.test.sh`
(the affected-scope script and the turbo task graph, in a throwaway git copy) and
`.github/scripts/ci-config.test.sh` (workflow, Dependabot and Sonar invariants). Run them with
`bash` from the repo root when you touch `.github/`, `turbo.json` or the root configs; they need
`jq` and `yq` (mikefarah v4).

A PR that changes CI or root configuration (`.github/workflows`, `.github/actions`,
`.github/scripts`, `.github/affected-paths.yml`, `turbo.json`, `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `biome.json`, `knip.json`,
`lefthook.yml`, `.semgrep/`, `sonar-project.properties`, `tools/vercel-cli/`, `tools/netlify-cli/`)
runs every job,
not just the affected ones.

`pnpm knip` runs knip twice: the default pass (whole project, tests included) and a
`--production` pass restricted to `dependencies,unlisted,unresolved,binaries`, which fails when a
runtime dependency is only used by tests or is missing from `package.json`.

Git hooks (lefthook) run Biome, gitleaks (if installed), OpenSpec validation and the lockfile
guard on commit, commitlint on the message, and affected typecheck + unit tests on push. The hooks
call the binaries directly from `./node_modules/.bin` (for example
`./node_modules/.bin/biome`), so they work even when `pnpm` is not on your PATH; run
`pnpm install` first so those binaries exist.

On a PR, the single required aggregate check is `ci-gate`, plus CodeQL, the PR title check, the
Git Flow guard and DCO. SonarQube Cloud reaches the rulesets through `ci-gate`: the `sonar` job
waits for the quality gate (`sonar.qualitygate.wait=true`) and fails when it fails. Do **not** add
the SonarQube Cloud App check ("SonarQube Cloud Code Analysis") as a required ruleset check: it is
never posted on fork PRs (no secrets, so the analysis is skipped), which would block them forever.

Maintainer setup: add `SONAR_TOKEN` both as a repository secret and as a **Dependabot** secret
(Settings → Secrets and variables → Dependabot). Dependabot PRs only see Dependabot secrets;
without it their Sonar analysis is skipped like a fork's.

The SonarQube Cloud free plan analyzes only the project's main branch and pull requests. The
project's main branch in SonarQube Cloud is `develop` (the GitHub default and integration branch),
so on push the `sonar` job runs only for `develop`; pushes to `main` (releases) are not analyzed.

## Non-commercial posture

The API runs on Vercel's Hobby plan, which is restricted to personal, non-commercial use. Do not
add ads, affiliate links, sponsored placements, paid features, or paid services tied to the
deployment. Donation links are allowed. Scraping and ingestion never run inside Vercel Functions;
they run in GitHub Actions.

## Pull request checklist

- [ ] Branch name and PR title follow the rules above.
- [ ] OpenSpec change created, validated and archived in this PR (when behavior changes).
- [ ] Docs checked via Context7 (IDs listed in `design.md`).
- [ ] Tests added or updated; all quality gates pass locally.
- [ ] User-facing text exists in both `en` and `pt-BR`; no hard-coded strings in components.
- [ ] Accessibility: keyboard reachable, labelled controls, WCAG 2.2 AA contrast.
- [ ] No secrets, personal data or generated `.env` files committed.
- [ ] Every commit is signed off (`git commit -s`) and signed.
