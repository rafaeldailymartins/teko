#!/usr/bin/env bash
# Testes do migration-guard.sh num repositório git temporário (sem rede).
# Uso: bash .github/scripts/migration-guard.test.sh (na raiz). Requer git e jq.
set -euo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/migration-guard.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
repo="$root/repo"
migrations="apps/api/drizzle/migrations"
failures=0

git_quiet() {
  git -C "$repo" -c core.autocrlf=false "$@" >/dev/null
}

reset_repo() {
  rm -rf "$repo"
  mkdir -p "$repo/$migrations/0001_init"
  git_quiet init -b main
  git_quiet config user.email t@example.invalid
  git_quiet config user.name t
  printf 'CREATE TABLE a (id int);\n' >"$repo/$migrations/0001_init/migration.sql"
  git_quiet add .
  git_quiet commit -m base
  git_quiet branch base
}

add_migration() {
  mkdir -p "$repo/$migrations/$1"
  printf '%s\n' "$2" >"$repo/$migrations/$1/migration.sql"
  git_quiet add .
  git_quiet commit -m "$1"
}

expect_exit() {
  local name="$1" expected="$2" labels="$3" status=0
  (cd "$repo" && BASE=base LABELS="$labels" bash "$guard") >"$root/out.txt" 2>&1 || status=$?
  if [[ "$status" == "$expected" ]]; then
    echo "ok - $name"
  else
    echo "not ok - $name (exit $status, esperado $expected)"
    sed 's/^/    /' "$root/out.txt"
    failures=$((failures + 1))
  fi
}

reset_repo
add_migration 0002_expand 'ALTER TABLE a ADD COLUMN b int;'
expect_exit "expand passa" 0 '[]'

reset_repo
add_migration 0002_snapshot 'ALTER TABLE a ADD COLUMN d int;'
printf '{ "concurrently": false, "drop": "x" }\n' >"$repo/$migrations/0002_snapshot/snapshot.json"
git_quiet add .
git_quiet commit -m snapshot
expect_exit "snapshot.json do drizzle-kit não conta" 0 '[]'

reset_repo
add_migration 0002_comment $'-- antes havia um DROP aqui\nALTER TABLE a ADD COLUMN c int;'
expect_exit "DROP só em comentário passa" 0 '[]'

reset_repo
add_migration 0002_drop 'ALTER TABLE a DROP COLUMN id;'
expect_exit "DROP sem label reprova" 1 '[]'
expect_exit "DROP com label contract passa" 0 '["contract"]'

reset_repo
add_migration 0002_rename 'ALTER TABLE a RENAME TO b;'
expect_exit "RENAME sem label reprova" 1 '["outro"]'

reset_repo
add_migration 0002_concurrently 'CREATE INDEX CONCURRENTLY a_id ON a (id);'
expect_exit "CONCURRENTLY reprova mesmo com contract" 1 '["contract"]'

reset_repo
printf 'CREATE TABLE a (id bigint);\n' >"$repo/$migrations/0001_init/migration.sql"
git_quiet commit -am edit
expect_exit "alterar migração existente reprova" 1 '["contract"]'

reset_repo
git_quiet rm -q "$migrations/0001_init/migration.sql"
git_quiet commit -m remove
expect_exit "remover migração existente reprova" 1 '["contract"]'

if (( failures > 0 )); then
  echo "$failures caso(s) falharam"
  exit 1
fi
echo "migration-guard: todos os casos passaram"
