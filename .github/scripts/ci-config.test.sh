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
  # Sem pipe: com `pipefail`, o `grep -q` pode sair no primeiro acerto antes de o `yq` terminar de
  # escrever; o SIGPIPE do `yq` vira status 141 e um FAIL falso.
  grep -Eq -- "$2" <<<"$(job_runs "$1")"
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
# Em push, o Sonar analisa a branch inteira: sem o lcov e o coverage.xml, o new_coverage vai a 0%
# e o quality gate reprova (sonar-push-without-coverage).
check "test roda sempre em push (lcov para o Sonar)" \
  bash -c "yq -r '.jobs.test.if' .github/workflows/ci.yml | grep -q \"github.event_name == 'push' ||\""
check "python roda sempre em push (coverage.xml para o Sonar)" \
  bash -c "yq -r '.jobs.python.if' .github/workflows/ci.yml | grep -q \"github.event_name == 'push' ||\""
check "ci-gate depende do workflow ci (que inclui o sonar)" \
  bash -c "yq -e '.jobs.\"ci-gate\".needs | contains([\"ci\"])' .github/workflows/pr-gate.yml >/dev/null"

# --- Gates da F2: mutação, sql-perf, migration-guard e retrieval evals entram no ci-gate --------
check "ci-gate depende de mutation e perf"   bash -c "yq -e '.jobs.\"ci-gate\".needs | contains([\"mutation\", \"perf\"])' .github/workflows/pr-gate.yml >/dev/null"
# Só mutation e perf podem pular (workflows só com jobs filtrados por escopo); ci e security, nunca.
check "ci-gate aceita skip só de mutation e perf" \
  bash -c "yq -r '.jobs.\"ci-gate\".steps[] | select(.uses // \"\" | test(\"alls-green\")) | .with.\"allowed-skips\"' .github/workflows/pr-gate.yml | jq -e 'sort == [\"mutation\", \"perf\"]' >/dev/null"
check "lint roda os testes do migration-guard" job_runs_match lint 'bash .github/scripts/migration-guard.test.sh'
check "migration-guard roda o script com os labels do PR" job_runs_match migration-guard 'bash .github/scripts/migration-guard.sh'
check "retrieval-evals aplica o gate do thresholds.json" job_runs_match retrieval-evals 'eval:retrieval:check'
check "retrieval-evals usa o fake de embeddings em modo strict"   bash -c "yq -e '.jobs.\"retrieval-evals\".env.EMBEDDINGS_FAKE_STRICT == \"true\"' .github/workflows/ci.yml >/dev/null"
check "perf roda o sql-perf"   bash -c "yq -r '.jobs.\"sql-perf\".steps[].run // \"\"' .github/workflows/perf.yml | grep -q 'test:sql-perf'"

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

# --- Dependabot: `semver-*-days` só nos ecossistemas que aceitam (dependabot-invalid-cooldown) ---
# O GitHub recusa o arquivo inteiro se github-actions, docker ou docker-compose trouxerem as
# chaves `semver-*-days` no `cooldown`, e nenhuma atualização roda (doc: "SemVer-bump days
# supported" na referência de opções do Dependabot).
dependabot_cooldown_supported() {
  local bad
  bad="$(yq -r '.updates[]
    | select(.["package-ecosystem"] == "github-actions" or .["package-ecosystem"] == "docker" or .["package-ecosystem"] == "docker-compose")
    | select(.cooldown // {} | keys | any_c(test("^semver-")))
    | .["package-ecosystem"]' .github/dependabot.yml)" || return 1
  if [[ -n "$bad" ]]; then
    echo "     cooldown com semver-*-days em: ${bad//$'\n'/, }"
    return 1
  fi
}
check "dependabot.yml sem semver-*-days onde o ecossistema não aceita" dependabot_cooldown_supported

# --- Exclusões ancoradas: nada de `**/out/**` (unanchored-out-excludes-adapters-out) ------------
no_unanchored_out_sonar() {
  ! grep -Eq '^\s*\*\*/out/\*\*' sonar-project.properties
}
no_unanchored_out_jscpd() {
  ! jq -e '.ignore[] | select(. == "**/out/**" or . == "out/**" or . == "**/out")' .jscpd.json >/dev/null
}
check "sonar.exclusions sem **/out/**" no_unanchored_out_sonar
check ".jscpd.json sem **/out/**" no_unanchored_out_jscpd

# --- Todo workflow: actions fixadas por SHA e checkout sem credenciais persistidas ---------------
actions_pinned_by_sha() {
  local bad
  bad="$(yq -r '.. | select(tag == "!!map" and has("uses")) | .uses' .github/workflows/*.yml .github/actions/*/action.yml |
    grep -Ev '^(\./|---$)|@[0-9a-f]{40}$' || true)"
  if [[ -n "$bad" ]]; then
    echo "     uses sem SHA: ${bad//$'\n'/, }"
    return 1
  fi
}
checkout_without_credentials() {
  local bad
  bad="$(yq -r '.jobs[]?.steps[]? | select(.uses // "" | test("^actions/checkout@")) | .with."persist-credentials" | tostring' \
    .github/workflows/*.yml | grep -Ev '^(false|---)$' || true)"
  [[ -z "$bad" ]]
}
check "actions fixadas por SHA (exceto as locais)" actions_pinned_by_sha
check "todo checkout com persist-credentials: false" checkout_without_credentials

# --- F3: ingest.yml (plano: Workflows; Environments e segredos) ---------------------------------
ingest=.github/workflows/ingest.yml
watch=.github/workflows/source-watch.yml

yq_true() {
  yq -e "$1" "$2" >/dev/null 2>&1
}
# Texto de um job inteiro (env, steps, with), para procurar segredos e comandos.
job_text() {
  yq -o=json ".jobs.\"$2\"" "$1"
}

check "ingest: harden-runner em block, como primeiro step, em todo job" \
  yq_true '[.jobs[] | select(has("steps")) | .steps[0].uses | test("^step-security/harden-runner@")] | all' "$ingest"
check "ingest: egress-policy block em todo job com steps" \
  yq_true '[.jobs[] | select(has("steps")) | .steps[0].with."egress-policy" == "block"] | all' "$ingest"
check "ingest: allowlist do discover e do load inclui api.netlify.com" \
  yq_true '[.jobs.discover, .jobs.load | .steps[0].with."allowed-endpoints" | test("(^|\\s)api\\.netlify\\.com:443")] | all' "$ingest"
check "ingest: allowlist do load inclui Cloudflare e Neon" \
  yq_true '.jobs.load.steps[0].with."allowed-endpoints" | (test("api\\.cloudflare\\.com:443") and test("neon\\.tech:5432"))' "$ingest"
check "ingest: discover, load e corpus-eval no environment staging" \
  yq_true '[.jobs.discover, .jobs.load, .jobs."corpus-eval" | .environment == "staging"] | all' "$ingest"
check "ingest: extract e docling-models sem environment" \
  yq_true '[.jobs.extract, .jobs."docling-models" | has("environment") | not] | all' "$ingest"
no_secrets_in_extract() {
  ! grep -Eq 'secrets\.' <<<"$(job_text "$ingest" extract)$(job_text "$ingest" docling-models)"
}
check "ingest: extract e docling-models não leem segredos" no_secrets_in_extract
check "ingest: extract em ubuntu-24.04 com timeout de 330 min" \
  yq_true '.jobs.extract."runs-on" == "ubuntu-24.04" and .jobs.extract."timeout-minutes" == 330' "$ingest"
check "ingest: cache dos modelos com a chave do uv.lock" \
  bash -c "grep -Fq \"key: docling-\\\${{ hashFiles('tools/ingest/uv.lock') }}\" '$ingest'"
check "ingest: modelos baixados com docling-tools no diretório do cache, só layout e tableformer" \
  bash -c "grep -Eq 'docling-tools models download --output-dir \\.cache/docling-models layout tableformer$' '$ingest'"
check "ingest: ModelScope fora da allowlist do docling-models" \
  bash -c "! yq -r '.jobs.\"docling-models\".steps[0].with.\"allowed-endpoints\"' '$ingest' | grep -q modelscope"
check "ingest: discover recusa fonte com ocr: true (sem modelo de OCR no cache)" \
  bash -c "yq -r '.jobs.discover.steps[].run // \"\"' '$ingest' | grep -Fq 'any(.[]; .ocr == true)'"
check "ingest: lock-pr e corpus-eval rodam com o extract pulado (!cancelled() e load success explícitos)" \
  yq_true '[.jobs."lock-pr", .jobs."corpus-eval" | .if | (test("!cancelled\\(\\)") and test("needs\\.load\\.result == .success."))] | all' "$ingest"
check "ingest: corpus-eval com o reranker do Workers AI (ADR 0027)" \
  bash -c "yq -r '.jobs.\"corpus-eval\".steps[].env.RERANKER_PROVIDER // \"\"' '$ingest' | grep -qx 'workers-ai'"
check "ingest: corpus-eval avalia o corpus real (EVAL_CORPUS=staging)" \
  bash -c "yq -r '.jobs.\"corpus-eval\".steps[].env.EVAL_CORPUS // \"\"' '$ingest' | grep -qx 'staging'"
check "ingest: corpus-eval com os limites do corpus real (retrieval-corpus), que nunca ficam abaixo da fixture no recall" \
  bash -c "yq -r '.jobs.\"corpus-eval\".steps[].run // \"\"' '$ingest' | grep -q 'corpus-eval-record.ts build' && jq -e '.\"retrieval-corpus\".\"recall@10\" >= .retrieval.\"recall@10\" and .\"retrieval-corpus\".vigencia == 1 and .\"retrieval-corpus\".recusa == 1' apps/api/evals/thresholds.json >/dev/null"
# RAGOps (ADR 0031): o corpus-eval mede os conjuntos dev e holdout e o lock só vai a PR com ele verde.
corpus_eval_dev_and_holdout() {
  local runs
  runs="$(yq -r '.jobs."corpus-eval".steps[].run // ""' "$ingest")"
  grep -q 'eval:retrieval$' <<<"$runs" && grep -q 'eval:retrieval:holdout$' <<<"$runs" &&
    grep -q -- '--holdout reports/retrieval-evals-holdout.json' <<<"$runs"
}
check "ingest: corpus-eval roda os conjuntos dev e holdout e grava o registro" corpus_eval_dev_and_holdout
check "ingest: lock-pr depende do corpus-eval verde e nunca roda para o código de um PR (ref)" \
  yq_true '(.jobs."lock-pr".needs | contains(["load", "corpus-eval"])) and (.jobs."lock-pr".if | (test("needs\\.corpus-eval\\.result == .success.") and test("inputs\\.ref == ..")))' "$ingest"
check "ingest: o PR do lock leva o corpus.eval.json" \
  bash -c "grep -Fq 'path: \"corpus/corpus.eval.json\"' '$ingest'"
check "ingest: modo eval-only pula o discover (e com ele extract e load)" \
  yq_true '(.on.workflow_dispatch.inputs.mode.options | join(",")) == "full,eval-only" and .on.workflow_call.inputs.mode.default == "full" and (.jobs.discover.if | test("inputs\\.mode != .eval-only."))' "$ingest"
check "ingest: o artifact corpus-lock dura 90 dias (eval-only abre o PR do lock a partir dele)" \
  yq_true '.jobs.load.steps[] | select(.with.name == "corpus-lock") | .with."retention-days" == 90' "$ingest"
label=.github/workflows/corpus-eval-label.yml
check "corpus-eval-label: só PR do próprio repositório, dispara o ingest.yml eval-only em develop" \
  bash -c "yq -e '.jobs.dispatch.if | test(\"head\\\\.repo\\\\.full_name == github\\\\.repository\")' '$label' >/dev/null && grep -Fq 'gh workflow run ingest.yml --repo \"\$REPO\" --ref develop -f mode=eval-only -f ref=\"\$SHA\"' '$label'"
check "ingest: load com --migrate só no staging" \
  bash -c "grep -Eq 'ingest load --target staging .*--migrate' '$ingest'"
check "ingest: o tamanho do staging (dbBytes do relatório) sai do load e vai ao resumo, com aviso acima de 400 MB" \
  yq_true '.jobs.load.outputs.db_bytes == "${{ steps.lock.outputs.db_bytes }}" and .jobs.summary.steps[-1].env.DB_BYTES == "${{ needs.load.outputs.db_bytes }}" and ([.jobs.load.steps[].run // "" | test("400 \\* 1024 \\* 1024")] | any)' "$ingest"
# Exceção http (ADR 0028): a única porta 80 liberada no ingest.yml é a do portal antigo do SPED, no
# discover (quem baixa), e a matriz do extract só aceita http desse host.
ingest_http_exception() {
  local endpoints port80
  endpoints="$(tr ' ' '\n' <<<"$(yq -r '.jobs[].steps[0].with."allowed-endpoints" // ""' "$ingest")")"
  port80="$(sort -u <<<"$(grep -E ':80$' <<<"$endpoints" || true)")"
  [[ "$port80" == "sped.rfb.gov.br:80" ]] &&
    [[ " $(yq -r '.jobs.discover.steps[0].with."allowed-endpoints"' "$ingest") " == *" sped.rfb.gov.br:80 "* ]] &&
    grep -Fq 'startswith("http://sped.rfb.gov.br/")' "$ingest"
}
check "ingest: exceção http só para o portal antigo do SPED (porta 80 no discover e matriz)" ingest_http_exception
check "ingest: código 75 do load não é falha" \
  bash -c "yq -r '.jobs.load.steps[].run // \"\"' '$ingest' | grep -Eq '^ *75\\)'"
check "ingest: target de dispatch só aceita staging" \
  yq_true '(.on.workflow_dispatch.inputs.target.options | length) == 1 and .on.workflow_dispatch.inputs.target.options[0] == "staging"' "$ingest"
check "ingest: PR do lock com o token da App teko-release-bot" \
  yq_true '.jobs."lock-pr".steps[] | select(.uses // "" | test("^actions/create-github-app-token@")) | .with."client-id" == "${{ vars.RELEASE_APP_CLIENT_ID }}"' "$ingest"
check "ingest: commit do lock com Signed-off-by e branch chore/corpus-lock-<run_id>" \
  bash -c "grep -Fq 'Signed-off-by: ' '$ingest' && grep -Fq 'branch=\"chore/corpus-lock-\${RUN_ID}\"' '$ingest' && grep -Fq 'RUN_ID: \${{ github.run_id }}' '$ingest'"
check "ingest: o PR do lock novo fecha os anteriores da própria App" \
  bash -c "grep -Fq -- '--author \"app/\${APP_SLUG}\"' '$ingest' && grep -Fq 'startswith(\"chore/corpus-lock-\")' '$ingest' && grep -Fq 'gh pr close \"\$old\"' '$ingest'"
check "ingest: falha cedo sem NETLIFY_SITE_ID ou NEON_STAGING_PROJECT_ID" \
  bash -c "yq -r '.jobs.discover.steps[].run // \"\"' '$ingest' | grep -q NETLIFY_SITE_ID && yq -r '.jobs.discover.steps[].run // \"\"' '$ingest' | grep -q NEON_STAGING_PROJECT_ID"

# --- F3: source-watch.yml -------------------------------------------------------------------------
check "source-watch: cron diário 0 9 * * *" \
  yq_true '.on.schedule[0].cron == "0 9 * * *"' "$watch"
check "source-watch: detect no staging e mark-coverage no corpus-watch" \
  yq_true '.jobs.detect.environment == "staging" and .jobs."mark-coverage".environment == "corpus-watch"' "$watch"
check "source-watch: mark-coverage depende do detect" \
  yq_true '.jobs."mark-coverage".needs == "detect"' "$watch"
mark_coverage_without_netlify() {
  ! grep -q 'NETLIFY' <<<"$(job_text "$watch" mark-coverage)"
}
check "source-watch: mark-coverage nunca vê o PAT da Netlify" mark_coverage_without_netlify
detect_without_database() {
  ! grep -Eq 'NEON_[A-Z_]*URL' <<<"$(job_text "$watch" detect)"
}
check "source-watch: detect não toca o banco" detect_without_database
mark_coverage_only_watch_secrets() {
  local used
  used="$(grep -Eo 'secrets[.][A-Z_]+' <<<"$(job_text "$watch" mark-coverage)" | sort -u)"
  [[ "$used" == $'secrets.NEON_PROD_WATCH_URL\nsecrets.NEON_STAGING_WATCH_URL' ]]
}
check "source-watch: mark-coverage só com os segredos do teko_watch" mark_coverage_only_watch_secrets
check "source-watch: dispara o ingest.yml no staging sem secrets: inherit" \
  yq_true '.jobs.ingest.uses == "./.github/workflows/ingest.yml" and .jobs.ingest.with.target == "staging" and (.jobs.ingest.secrets | type) == "!!map"' "$watch"

# --- Semgrep: as fixtures rodam no CI (GHA-4) ---------------------------------------------------
check "security.yml roda semgrep test .semgrep/" \
  bash -c "yq -r '.jobs.semgrep.steps[].run // \"\"' .github/workflows/security.yml | grep -q 'semgrep test .semgrep/'"

echo
if ((failures > 0)); then
  echo "${failures} de ${cases} verificação(ões) falharam."
  exit 1
fi
echo "${cases} verificação(ões) ok."
