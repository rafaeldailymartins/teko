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
git update-ref refs/remotes/origin/develop "$base_sha"

all='{"web":true,"api":true,"shared":true,"ingest":true,"rag":true,"llm":true,"packages":true}'
none='{"web":false,"api":false,"shared":false,"ingest":false,"rag":false,"llm":false,"packages":false}'
packages_only='{"web":true,"api":true,"shared":true,"ingest":false,"rag":false,"llm":false,"packages":true}'
ingest_only='{"web":false,"api":false,"shared":false,"ingest":true,"rag":false,"llm":false,"packages":false}'

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
  if ! EVENT_NAME="$event" BASE_REF=develop BEFORE_SHA="$base_sha" GITHUB_OUTPUT="$out" \
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
expect_scope "docs: nada afetado" "$none" push docs/adr/0002-supply-chain-pnpm.md README.md
expect_scope "pull_request contra origin/develop" "$packages_only" pull_request \
  packages/shared/src/errors/codes.ts

# --- Configuração de CI e da raiz: tudo afetado --------------------------------------------------
global_files=(
  .github/workflows/ci.yml
  .github/workflows/pr-gate.yml
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
  tools/netlify-cli/package.json
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
