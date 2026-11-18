#!/usr/bin/env bash
# staging-verified (F7): o commit só vai para produção se o último run concluído do deploy.yml em
# `main` para aquele SHA terminou verde (build atestado, migrate, deploy, smoke e, quando ligado, o
# system test do staging). Usado pelo release.yml antes de criar a tag e pelo deploy.yml de produção
# antes de construir. Na F9 vira parte do job `release-gate`.
#
# Uso: GH_TOKEN=<token com actions: read> REPO=<dono/repo> bash .github/scripts/staging-verified.sh <sha>
# Saída: 0 verde; 1 sem run, run em andamento ou vermelho; 2 uso errado.
set -euo pipefail

sha="${1:-}"
repo="${REPO:?defina REPO (dono/repo)}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "uso: REPO=<dono/repo> bash .github/scripts/staging-verified.sh <sha de 40 hex>" >&2
  exit 2
fi

runs="$(gh run list --repo "$repo" --workflow deploy.yml --branch main --commit "$sha" \
  --limit 20 --json databaseId,status,conclusion,event,createdAt,url)"
latest="$(jq -c '[.[] | select(.status == "completed")] | sort_by(.createdAt) | last // empty' <<<"$runs")"
pending="$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")"

if [[ -z "$latest" ]]; then
  if ((pending > 0)); then
    echo "::error title=staging-verified::o deploy de staging de ${sha} ainda está rodando; espere terminar."
  else
    echo "::error title=staging-verified::nenhum run do deploy.yml em main para ${sha}; o commit nunca foi para o staging."
  fi
  exit 1
fi

conclusion="$(jq -r '.conclusion' <<<"$latest")"
url="$(jq -r '.url' <<<"$latest")"
if [[ "$conclusion" != success ]]; then
  echo "::error title=staging-verified::o último deploy de staging de ${sha} terminou ${conclusion}: ${url}"
  exit 1
fi
echo "staging verde para ${sha}: ${url}"
