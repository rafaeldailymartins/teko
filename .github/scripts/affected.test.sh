#!/usr/bin/env bash
# Testes de regressão do .github/scripts/affected.sh e do grafo de tasks do turbo.json.
#
# Copia o repositório (arquivos versionados e não ignorados) para um diretório temporário com git
# próprio, faz um commit por cenário a partir da mesma base e confere:
#   1. o JSON de escopo que o affected.sh grava em $GITHUB_OUTPUT;
#   2. que `turbo run <checks> --affected` seleciona os checks de api/web quando só o
#      packages/shared muda (a task `transit` do turbo.json põe os inputs do shared no hash dos
#      dependentes; sem ela, o --affected com affectedUsingTaskInputs pulava api/web).
#
# Uso: bash .github/scripts/affected.test.sh (na raiz, com `pnpm install` feito). Requer git, jq e
# yq (mikefarah v4), os mesmos do affected.sh. O diretório temporário segue $TMPDIR.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
turbo_bin="${repo_root}/node_modules/.bin/turbo"
if [[ ! -x "$turbo_bin" ]]; then
  echo "::error title=affected.test::${turbo_bin} não existe; rode pnpm install antes."
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# O affected.sh chama `pnpm exec turbo`; a cópia não tem node_modules, então um shim aponta para o
# turbo instalado no repositório.
mkdir -p "${work}/bin"
cat >"${work}/bin/pnpm" <<EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == exec && "\${2:-}" == turbo ]]; then
  shift 2
  exec "${turbo_bin}" "\$@"
fi
echo "pnpm (shim do affected.test.sh): comando inesperado: \$*" >&2
exit 2
EOF
chmod +x "${work}/bin/pnpm"
export PATH="${work}/bin:${PATH}"
export TURBO_TELEMETRY_DISABLED=1

copy="${work}/repo"
mkdir -p "$copy"
(
  cd "$repo_root"
  git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf -
) | tar -xf - -C "$copy"

cd "$copy"
git init -q -b main
git config user.email affected-test@example.invalid
git config user.name affected-test
git config core.autocrlf false
git config commit.gpgsign false
git add -A
git commit -qm base
base_sha="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main "$base_sha"

all='{"web":true,"api":true,"shared":true,"ingest":true,"rag":true,"llm":true,"docs":true,"code":true,"packages":true}'
# Só código fora de qualquer grupo (ex.: um workflow agendado): nenhum gate de pacote, lint inteiro.
code_only='{"web":false,"api":false,"shared":false,"ingest":false,"rag":false,"llm":false,"docs":false,"code":true,"packages":false}'
docs_only='{"web":false,"api":false,"shared":false,"ingest":false,"rag":false,"llm":false,"docs":true,"code":false,"packages":false}'
packages_only='{"web":true,"api":true,"shared":true,"ingest":false,"rag":false,"llm":false,"docs":false,"code":true,"packages":true}'
ingest_only='{"web":false,"api":false,"shared":false,"ingest":true,"rag":false,"llm":false,"docs":false,"code":true,"packages":false}'
api_ingest='{"web":false,"api":true,"shared":false,"ingest":true,"rag":false,"llm":false,"docs":false,"code":true,"packages":true}'
api_only='{"web":false,"api":true,"shared":false,"ingest":false,"rag":false,"llm":false,"docs":false,"code":true,"packages":true}'
api_rag='{"web":false,"api":true,"shared":false,"ingest":false,"rag":true,"llm":false,"docs":false,"code":true,"packages":true}'
# Markdown dentro de corpus/: ingest (corpus/**) e docs (**/*.md); nada fora de docs, então code=false.
ingest_docs='{"web":false,"api":false,"shared":false,"ingest":true,"rag":false,"llm":false,"docs":true,"code":false,"packages":false}'

failures=0
cases=0

# Volta à base e commita uma linha a mais em cada arquivo dado (criando-o se preciso).
commit_change() {
  local name="$1"
  shift
  git checkout -q --detach "$base_sha"
  local file
  for file in "$@"; do
    mkdir -p "$(dirname "$file")"
    printf '\n' >>"$file"
  done
  git add -A
  git commit -qm "$name"
}

# expect_scope <nome> <json esperado> <evento> <arquivo>...
expect_scope() {
  local name="$1" expected="$2" event="$3"
  shift 3
  cases=$((cases + 1))
  commit_change "$name" "$@"
  local out="${work}/github_output"
  : >"$out"
  if ! EVENT_NAME="$event" BASE_REF=main BEFORE_SHA="$base_sha" GITHUB_OUTPUT="$out" \
    GITHUB_STEP_SUMMARY='' bash .github/scripts/affected.sh >"${work}/affected.log" 2>&1; then
    echo "FAIL ${name}: affected.sh saiu com erro"
    cat "${work}/affected.log"
    failures=$((failures + 1))
    return
  fi
  local actual
  actual="$(sed -n 's/^json=//p' "$out")"
  if jq -en --argjson a "$actual" --argjson e "$expected" '$a == $e' >/dev/null; then
    echo "ok   ${name}"
  else
    echo "FAIL ${name}"
    echo "     esperado: ${expected}"
    echo "     obtido:   ${actual}"
    failures=$((failures + 1))
  fi
}

# expect_tasks <nome> <task>... (depois de um commit_change): o --affected precisa selecionar
# cada task listada.
expect_tasks() {
  local name="$1"
  shift
  cases=$((cases + 1))
  local dry="${work}/dry.json"
  TURBO_SCM_BASE="$base_sha" "$turbo_bin" run typecheck test:unit test:integration lint:deps \
    type-coverage --affected --dry=json >"$dry" 2>"${work}/turbo.err"
  local missing=()
  local task
  for task in "$@"; do
    if ! jq -e --arg t "$task" 'any(.tasks[]; .taskId == $t)' "$dry" >/dev/null; then
      missing+=("$task")
    fi
  done
  if ((${#missing[@]} == 0)); then
    echo "ok   ${name}"
  else
    echo "FAIL ${name}: não selecionadas: ${missing[*]}"
    echo "     selecionadas: $(jq -r '[.tasks[].taskId] | join(" ")' "$dry")"
    failures=$((failures + 1))
  fi
}

# --- Mudança só no pacote compartilhado: os dependentes entram (escopo e tasks) ---------------
expect_scope "shared: escopo inclui web e api" "$packages_only" push \
  packages/shared/src/errors/codes.ts
expect_tasks "shared: --affected roda os checks de api e web" \
  '@teko/api#typecheck' '@teko/web#typecheck' \
  '@teko/api#test:unit' '@teko/web#test:unit' \
  '@teko/api#test:integration' '@teko/api#lint:deps' \
  '@teko/api#type-coverage' '@teko/web#type-coverage'

# --- Grupos por caminho e controles negativos ---------------------------------------------------
expect_scope "tools/ingest: só ingest" "$ingest_only" push tools/ingest/pyproject.toml
expect_scope "corpus/watch.yaml: só ingest" "$ingest_only" push corpus/watch.yaml
# Arquivos da API no grupo ingest: o turbo marca a api e o grupo por caminho marca o ingest.
expect_scope "cli/sources-watch: api + ingest" "$api_ingest" push \
  apps/api/src/adapters/in/cli/sources-watch/watch-config.ts
expect_scope "cli/snapshot: api + ingest" "$api_ingest" push \
  apps/api/src/adapters/in/cli/snapshot/novo-arquivo.ts
expect_scope "domain/corpus: api + ingest" "$api_ingest" push \
  apps/api/src/domain/corpus/family.ts
# Controle negativo: outro adapter de entrada da API não é ingestão.
expect_scope "adapters/in/http: só api" "$api_only" push \
  apps/api/src/adapters/in/http/novo-arquivo.ts
# Reranker e embeddings mudam a ordem e os vetores da busca: entram no grupo rag (ADR 0031).
expect_scope "adapters/out/reranker: api + rag" "$api_rag" push \
  apps/api/src/adapters/out/reranker/workers-ai/novo-arquivo.ts
expect_scope "adapters/out/embeddings: api + rag" "$api_rag" push \
  apps/api/src/adapters/out/embeddings/workers-ai/novo-arquivo.ts
# Grupo docs: docs/**, openspec/** e todo Markdown, em qualquer profundidade.
expect_scope "docs e README da raiz: só docs" "$docs_only" push \
  docs/adr/0002-supply-chain-pnpm.md README.md
expect_scope "openspec: só docs" "$docs_only" push openspec/specs/hybrid-search/spec.md
expect_scope "Markdown dentro de corpus/: ingest + docs" "$ingest_docs" push corpus/README.md
expect_scope "corpus sem Markdown: sem docs" "$ingest_only" push corpus/leiaute-periods.yaml
expect_scope "arquivo da raiz fora de todo grupo: só code" "$code_only" push LICENSE
expect_scope "pull_request contra origin/main" "$packages_only" pull_request \
  packages/shared/src/errors/codes.ts

# --- Grupo docs (ADR 0032): PR só de documentação não tem código ---------------------------------
expect_scope "docs: só docs, sem código" "$docs_only" push \
  docs/adr/0002-supply-chain-pnpm.md README.md openspec/specs/quality-gates/spec.md \
  .claude/settings.json
# Markdown dentro de um pacote: o turbo marca o pacote (o `--affected` das tasks, que excluem
# **/*.md dos inputs, não seleciona nada), mas não há código para o lint.
expect_scope "docs dentro do web: web pelo turbo, sem código" \
  '{"web":true,"api":false,"shared":false,"ingest":false,"rag":false,"llm":false,"docs":true,"code":false,"packages":true}' \
  push apps/web/NOTAS.md
expect_scope "docs + um arquivo fora do grupo: tem código" \
  '{"web":false,"api":false,"shared":false,"ingest":false,"rag":false,"llm":false,"docs":true,"code":true,"packages":false}' \
  push docs/adr/0002-supply-chain-pnpm.md .editorconfig

# --- Workflows que não definem gates de PR: não marcam tudo --------------------------------------
for file in .github/workflows/mutation.yml .github/workflows/audit.yml .github/workflows/scorecard.yml \
  .github/workflows/codeql.yml .github/workflows/pr-hygiene.yml .github/workflows/sonar.yml; do
  expect_scope "workflow sem gate de PR: ${file}" "$code_only" push "$file"
done
expect_scope "ingest.yml: só ingest" "$ingest_only" push .github/workflows/ingest.yml
expect_scope "source-watch.yml: só ingest" "$ingest_only" push .github/workflows/source-watch.yml

# --- Configuração de CI e da raiz: tudo afetado --------------------------------------------------
global_files=(
  .github/workflows/ci.yml
  .github/workflows/pr-gate.yml
  .github/workflows/perf.yml
  .github/actions/setup/action.yml
  .github/scripts/affected.sh
  .github/affected-paths.yml
  turbo.json
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json
  tsconfig.scripts.json
  biome.json
  knip.json
  lefthook.yml
  .semgrep/teko.yml
  sonar-project.properties
  tools/vercel-cli/package.json
)
for file in "${global_files[@]}"; do
  expect_scope "global: ${file}" "$all" push "$file"
done

# --- Arquivo de grupos quebrado: falha no próprio PR, mesmo com tudo afetado ---------------------
cases=$((cases + 1))
git checkout -q --detach "$base_sha"
yq -i 'del(.rag)' .github/affected-paths.yml
git commit -qam "grupo rag removido"
if EVENT_NAME=push BEFORE_SHA="$base_sha" GITHUB_OUTPUT="${work}/github_output" \
  GITHUB_STEP_SUMMARY='' bash .github/scripts/affected.sh >"${work}/affected.log" 2>&1; then
  echo "FAIL affected-paths.yml sem o grupo rag: affected.sh deveria falhar"
  failures=$((failures + 1))
else
  echo "ok   affected-paths.yml sem o grupo rag falha"
fi

echo
if ((failures > 0)); then
  echo "${failures} de ${cases} cenário(s) falharam."
  exit 1
fi
echo "${cases} cenário(s) ok."
