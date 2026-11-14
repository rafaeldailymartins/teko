#!/usr/bin/env bash
# Sobe a stack descartável de CI (infra/ci/compose.yaml) com a fixture única e uma sessão de teste:
#
#   1. imagem candidata da API (apps/api/Dockerfile) e export estático do web;
#   2. Postgres, com os roles do Neon;
#   3. migrações e fixture pelo mesmo caminho da ingestão (cli seed-fixtures, owner);
#   4. API (APP_ENV=ci, LLM e embeddings fake) e Caddy em http://localhost:8080;
#   5. usuário e sessão de teste (cli seed-dev-session): o cookie vai para E2E_SESSION_COOKIE no
#      $GITHUB_ENV (Actions) ou para infra/ci/.e2e.env (local, fora do git).
#
# Uso: bash infra/ci/up.sh (na raiz; Docker e pnpm). Derruba com:
#   BETTER_AUTH_SECRET=teardown docker compose -f infra/ci/compose.yaml down --volumes
set -euo pipefail

cd "$(dirname "$0")/../.."
compose=(docker compose -f infra/ci/compose.yaml)

# Segredo do Better Auth da stack: aleatório a cada subida, nunca reaproveitado.
BETTER_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export BETTER_AUTH_SECRET

echo "::group::imagem da API e export do web"
docker build -f apps/api/Dockerfile \
  --build-arg APP_VERSION=0.0.0 --build-arg "GIT_SHA=$(git rev-parse HEAD)" \
  -t teko-api:ci .
pnpm --filter @teko/web build
echo "::endgroup::"

echo "::group::Postgres, migrações e fixture"
"${compose[@]}" up -d --wait postgres
owner_url='postgresql://teko_owner:owner-ci-only@127.0.0.1:55432/teko'
app_url='postgresql://teko_app:app-ci-only@127.0.0.1:55432/teko'
(
  cd apps/api
  APP_ENV=ci WEB_ORIGIN=http://localhost:8080 DATABASE_URL="$owner_url" \
    EMBEDDINGS_PROVIDER=fake EMBEDDINGS_FIXTURE_PATH=test/fixtures/corpus/embeddings.json.gz \
    node src/cli.ts seed-fixtures --migrate
)
echo "::endgroup::"

echo "::group::API e Caddy"
"${compose[@]}" up -d --wait api caddy
echo "::endgroup::"

session="$(
  cd apps/api
  APP_ENV=ci WEB_ORIGIN=http://localhost:8080 DATABASE_URL="$app_url" \
    BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    EMBEDDINGS_PROVIDER=fake EMBEDDINGS_FIXTURE_PATH=test/fixtures/corpus/embeddings.json.gz \
    node src/cli.ts seed-dev-session --email e2e@teko.localhost --name 'E2E'
)"
cookie="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).cookie)' "$session")"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "::add-mask::${cookie#*=}"
  echo "E2E_SESSION_COOKIE=$cookie" >>"$GITHUB_ENV"
else
  printf 'E2E_SESSION_COOKIE=%s\n' "$cookie" >infra/ci/.e2e.env
  echo "cookie de sessão em infra/ci/.e2e.env"
fi
echo "stack de CI no ar em http://localhost:8080"
