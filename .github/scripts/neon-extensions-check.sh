#!/usr/bin/env bash
# Confere, depois do `drizzle-kit migrate`, as extensões e os parâmetros de que a API depende no
# banco (deploy.yml e neon-rehearsal.yml, F7):
#
# - `pg_extension`: vector, unaccent, pg_trgm e btree_gist instaladas (migração `*_extensions`),
#   com vector >= 0.8.0 (o `halfvec` pede 0.7, e o `hnsw.iterative_scan` da busca híbrida, 0.8);
# - `pg_settings`: `hnsw.iterative_scan`, `hnsw.ef_search` e `hnsw.max_scan_tuples` existem
#   (`HNSW_SETTINGS_SQL` de `apps/api/src/adapters/out/persistence/drizzle/sql/hybrid-search.ts`).
#
# Uso: DATABASE_MIGRATE_URL=<url direta do owner> bash .github/scripts/neon-extensions-check.sh
# Requer psql (o runner ubuntu-24.04 já traz). A URL nunca é impressa.
set -euo pipefail

url="${DATABASE_MIGRATE_URL:?defina DATABASE_MIGRATE_URL}"
MIN_VECTOR=0.8.0

report="$(
  psql -X -v ON_ERROR_STOP=1 -tA "$url" <<'SQL'
SELECT 'ext:' || extname || '=' || extversion FROM pg_extension
  WHERE extname IN ('vector', 'unaccent', 'pg_trgm', 'btree_gist') ORDER BY extname;
-- Carrega a biblioteca do pgvector na sessão: os parâmetros hnsw.* só aparecem depois disso.
DO $$ BEGIN PERFORM '[1]'::vector; END $$;
SELECT 'set:' || name FROM pg_settings
  WHERE name IN ('hnsw.ef_search', 'hnsw.iterative_scan', 'hnsw.max_scan_tuples') ORDER BY name;
SQL
)"

fail=0
for ext in btree_gist pg_trgm unaccent vector; do
  if ! grep -q "^ext:${ext}=" <<<"$report"; then
    echo "::error title=neon-extensions::extensão ${ext} ausente."
    fail=1
  fi
done
vector_version="$(sed -n 's/^ext:vector=//p' <<<"$report")"
if [[ -n "$vector_version" ]]; then
  lowest="$(printf '%s\n%s\n' "$MIN_VECTOR" "$vector_version" | sort -V | head -n 1)"
  if [[ "$lowest" != "$MIN_VECTOR" ]]; then
    echo "::error title=neon-extensions::pgvector ${vector_version}; a busca híbrida pede >= ${MIN_VECTOR}."
    fail=1
  fi
fi
for setting in hnsw.ef_search hnsw.iterative_scan hnsw.max_scan_tuples; do
  if ! grep -qx "set:${setting}" <<<"$report"; then
    echo "::error title=neon-extensions::parâmetro ${setting} ausente em pg_settings."
    fail=1
  fi
done

grep -E '^(ext|set):' <<<"$report" | sed 's/^/  /'
exit "$fail"
