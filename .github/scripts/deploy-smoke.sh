#!/usr/bin/env bash
# Smoke do deploy.yml (F7): chama o scripts/smoke.ts da mudança add-smoke-tests com o contrato
#
#   node scripts/smoke.ts --env staging|production --mode deployment|canonical \
#     --base-url <url> --expected-sha <40 hex> [--out <arquivo.json>]
#
# (no modo deployment ele lê VERCEL_AUTOMATION_BYPASS_SECRET do ambiente). Enquanto o smoke.ts não
# existir no commit implantado, faz um smoke mínimo, com ::warning: `/healthz` com `status: ok` e o
# `gitSha` esperado, com o bypass de automação no header (URL única, protegida) ou sem nada
# (domínio canônico, público). No canônico, repete por até 2 min: logo depois do `vercel promote`
# o domínio ainda pode servir a deployment anterior (spike F1 (b)).
#
# Uso: bash .github/scripts/deploy-smoke.sh <env> <mode> <base-url> <expected-sha> [<out.json>]
# Saída: 0 smoke verde; 1 falha; 2 uso errado.
set -euo pipefail

usage() {
  echo "uso: bash .github/scripts/deploy-smoke.sh staging|production deployment|canonical <https://*.vercel.app> <sha de 40 hex> [<out.json>]" >&2
  exit 2
}

(($# == 4 || $# == 5)) || usage
env_name="$1"
mode="$2"
base_url="$3"
expected_sha="$4"
out="${5:-}"

[[ "$env_name" == staging || "$env_name" == production ]] || usage
[[ "$mode" == deployment || "$mode" == canonical ]] || usage
[[ "$base_url" =~ ^https://[a-z0-9.-]+\.vercel\.app$ ]] || usage
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || usage

if [[ -f scripts/smoke.ts ]]; then
  args=(--env "$env_name" --mode "$mode" --base-url "$base_url" --expected-sha "$expected_sha")
  if [[ -n "$out" ]]; then
    args+=(--out "$out")
  fi
  exec node scripts/smoke.ts "${args[@]}"
fi

echo "::warning title=deploy-smoke::scripts/smoke.ts não existe neste commit: smoke mínimo (só /healthz com o gitSha esperado)."

curl_args=(-sS --max-time 20)
if [[ "$mode" == deployment ]]; then
  if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
    echo "::error title=deploy-smoke::sem VERCEL_AUTOMATION_BYPASS_SECRET para a URL única (protegida)."
    exit 1
  fi
  # O header vai por arquivo (curl -H @arquivo): o segredo não aparece na linha de comando.
  header_file="$(mktemp)"
  trap 'rm -f "$header_file"' EXIT
  chmod 600 "$header_file"
  printf 'x-vercel-protection-bypass: %s\n' "$VERCEL_AUTOMATION_BYPASS_SECRET" >"$header_file"
  curl_args+=(-H "@${header_file}")
  attempts=6
else
  attempts=24
fi

got=''
for ((i = 1; i <= attempts; i++)); do
  body="$(curl "${curl_args[@]}" "${base_url}/healthz" || true)"
  status="$(jq -r '.status // empty' <<<"$body" 2>/dev/null || true)"
  got="$(jq -r '.gitSha // empty' <<<"$body" 2>/dev/null || true)"
  if [[ "$status" == ok && "$got" == "$expected_sha" ]]; then
    echo "smoke mínimo ($mode): ${base_url}/healthz com status ok e gitSha ${expected_sha}"
    if [[ -n "$out" ]]; then
      jq -n --arg mode "$mode" --arg url "$base_url" --arg sha "$expected_sha" \
        '{mode: $mode, baseUrl: $url, gitSha: $sha, minimal: true, ok: true}' >"$out"
    fi
    exit 0
  fi
  sleep 5
done

echo "::error title=deploy-smoke::${base_url}/healthz não devolveu status ok com gitSha ${expected_sha} (último gitSha: ${got:-nenhum})."
exit 1
