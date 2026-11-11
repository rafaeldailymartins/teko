#!/usr/bin/env bash
# migration-guard: migrações sempre expand/contract (plano: Backend > Migrações). Reprova o PR se
# alguma migração adicionada ou alterada tiver, nas linhas novas:
#   - DROP (tabela, coluna, constraint, índice, schema...) ou RENAME, sem o label `contract` no PR;
#   - CREATE INDEX CONCURRENTLY (não roda dentro da transação do drizzle-kit migrate), sempre;
#   - alteração em migração já existente na base (migração publicada é imutável), sempre.
#
# Uso: BASE=<ref> LABELS='["contract", ...]' bash .github/scripts/migration-guard.sh
#   BASE   ref da base do diff (ex.: origin/develop);
#   LABELS JSON com os nomes dos labels do PR (vazio = nenhum).
set -euo pipefail

MIGRATIONS_DIR="apps/api/drizzle/migrations"
base="${BASE:?defina BASE (ex.: origin/develop)}"
labels="${LABELS:-[]}"

has_contract_label() {
  jq -e 'index("contract") != null' <<<"$labels" >/dev/null
}

fail=0
report() {
  echo "::error title=migration-guard::$1"
  fail=1
}

# Migrações alteradas (M) ou removidas (D) em relação à base: proibido.
while IFS=$'\t' read -r status path; do
  [[ -z "${path:-}" ]] && continue
  case "$status" in
    D) what=removida ;;
    *) what=alterada ;;
  esac
  report "${path}: migração existente foi ${what} (migração publicada é imutável; crie uma nova)"
done < <(git diff --name-status --diff-filter=MD "${base}...HEAD" -- "${MIGRATIONS_DIR}/**/migration.sql" "${MIGRATIONS_DIR}/*/migration.sql" | sort -u)

# Linhas adicionadas nas migrações novas, sem comentários SQL de linha inteira.
added="$(git diff --unified=0 --diff-filter=A "${base}...HEAD" -- "${MIGRATIONS_DIR}" \
  | grep -E '^\+[^+]' | sed -E 's/^\+//' | grep -vE '^\s*--' || true)"

if grep -qiE '\bCONCURRENTLY\b' <<<"$added"; then
  report "CREATE INDEX CONCURRENTLY não roda na transação do drizzle-kit migrate; use CREATE INDEX"
fi

destructive="$(grep -iE '\b(DROP|RENAME)\b' <<<"$added" || true)"
if [[ -n "$destructive" ]]; then
  if has_contract_label; then
    echo "::notice title=migration-guard::DROP/RENAME autorizado pelo label contract:"
    echo "$destructive"
  else
    report "DROP/RENAME em migração sem o label 'contract' (expand/contract): $(head -c 300 <<<"$destructive" | tr '\n' ' ')"
  fi
fi

if (( fail == 0 )); then
  echo "migration-guard: ok"
fi
exit "$fail"
