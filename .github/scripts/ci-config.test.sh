#!/usr/bin/env bash
# Testes de regressão da configuração de CI: invariantes que já quebraram uma vez e que nenhum
# linter (actionlint, zizmor) enxerga, porque o YAML continua válido sem elas.
#
# Uso: bash .github/scripts/ci-config.test.sh (na raiz). Requer yq (mikefarah v4) e jq.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

failures=0
cases=0

check() {
  local name="$1"
  shift
  cases=$((cases + 1))
  if "$@"; then
    echo "ok   ${name}"
  else
    echo "FAIL ${name}"
    failures=$((failures + 1))
  fi
}

# Texto de todos os `run:` de um job do ci.yml.
job_runs() {
  yq -r ".jobs.\"$1\".steps[].run // \"\"" .github/workflows/ci.yml
}

job_runs_match() {
  job_runs "$1" | grep -Eq -- "$2"
}

# --- Gates do plano que o CI precisa rodar (plan-gates-missing-in-ci) --------------------------
check "lint roda o jscpd (pnpm dup)" job_runs_match lint '^pnpm dup$'
check "lint roda turbo boundaries" job_runs_match lint 'turbo boundaries'
check "lint roda os testes do affected.sh" job_runs_match lint 'bash \.github/scripts/affected\.test\.sh'
check "lint roda este teste" job_runs_match lint 'bash \.github/scripts/ci-config\.test\.sh'
check "typecheck roda type-coverage no --affected" \
  job_runs_match typecheck 'turbo run .*type-coverage.*--affected'

# --- Sonar: o resultado do quality gate entra no ci-gate (GHA-3) -------------------------------
sonar_args() {
  yq -r '.jobs.sonar.steps[] | select(.uses // "" | test("sonarqube-scan-action")) | .with.args' \
    .github/workflows/ci.yml
}
check "sonar espera e aplica o quality gate" \
  bash -c "$(declare -f sonar_args); sonar_args | grep -q 'sonar.qualitygate.wait=true'"
check "sonar com timeout do quality gate" \
  bash -c "$(declare -f sonar_args); sonar_args | grep -Eq 'sonar.qualitygate.timeout=[0-9]+'"
check "sonar pula sem SONAR_TOKEN (fork/Dependabot sem o segredo)" \
  bash -c "yq -r '.jobs.sonar.steps[].run // \"\"' .github/workflows/ci.yml | grep -q 'if \[\[ -z \"\${SONAR_TOKEN}\" \]\]'"
check "ci-gate depende do workflow ci (que inclui o sonar)" \
  bash -c "yq -e '.jobs.\"ci-gate\".needs | contains([\"ci\"])' .github/workflows/pr-gate.yml >/dev/null"

# --- Dependabot só aponta para diretórios que existem (GHA-5) ----------------------------------
dependabot_dirs_exist() {
  local dirs dir ok=0
  dirs="$(yq -r '.updates[] | ([.directory] + (.directories // [])) | .[] | select(. != null)' \
    .github/dependabot.yml)" || return 1
  [[ -n "$dirs" ]] || return 1
  while IFS= read -r dir; do
    dir="${dir%$'\r'}"
    [[ -z "$dir" ]] && continue
    # `directories` aceita glob (/.github/actions/*).
    if ! compgen -G ".${dir}" >/dev/null; then
      echo "     diretório inexistente no dependabot.yml: ${dir}"
      ok=1
    fi
  done <<<"$dirs"
  return "$ok"
}
check "dependabot.yml sem diretórios inexistentes" dependabot_dirs_exist

# --- Exclusões ancoradas: nada de `**/out/**` (unanchored-out-excludes-adapters-out) ------------
no_unanchored_out_sonar() {
  ! grep -Eq '^\s*\*\*/out/\*\*' sonar-project.properties
}
no_unanchored_out_jscpd() {
  ! jq -e '.ignore[] | select(. == "**/out/**" or . == "out/**" or . == "**/out")' .jscpd.json >/dev/null
}
check "sonar.exclusions sem **/out/**" no_unanchored_out_sonar
check ".jscpd.json sem **/out/**" no_unanchored_out_jscpd

# --- Semgrep: as fixtures rodam no CI (GHA-4) ---------------------------------------------------
check "security.yml roda semgrep test .semgrep/" \
  bash -c "yq -r '.jobs.semgrep.steps[].run // \"\"' .github/workflows/security.yml | grep -q 'semgrep test .semgrep/'"

echo
if ((failures > 0)); then
  echo "${failures} de ${cases} verificação(ões) falharam."
  exit 1
fi
echo "${cases} verificação(ões) ok."
