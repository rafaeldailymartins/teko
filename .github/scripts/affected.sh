#!/usr/bin/env bash
# Calcula o escopo afetado de um PR ou push para os gates do CI.
#
# - web, api, shared: `turbo query affected --packages` (dependentes incluídos pelo turbo).
# - ingest, rag, llm: `git diff --name-only <base>...HEAD` contra os globs de
#   .github/affected-paths.yml (pathspec `:(glob)` do git).
# - packages: true se qualquer pacote JS foi afetado.
#
# Mudança na configuração que define ou executa os gates (workflows, a composite de setup, os
# scripts do CI, este escopo, turbo/pnpm/tsconfig/biome/knip/lefthook da raiz, regras do Semgrep,
# Sonar, o Vercel CLI isolado) marca tudo como afetado: o turbo não enxerga esses arquivos (ou
# enxerga só parte deles), e um PR que mexe num gate precisa exercitá-lo antes do merge.
#
# Sem base comparável (agendamento, dispatch, primeiro push de um branch, base inexistente),
# tudo é considerado afetado: na dúvida, roda.
#
# Entrada (variáveis de ambiente): EVENT_NAME, BASE_REF (pull_request), BEFORE_SHA (push),
# AFFECTED_PATHS_FILE (opcional). Requer git com histórico completo, jq, yq (mikefarah v4) e
# as dependências do pnpm instaladas (turbo).
# Saída: chaves em $GITHUB_OUTPUT (uma por grupo e `json`) e resumo em $GITHUB_STEP_SUMMARY.
set -euo pipefail

config="${AFFECTED_PATHS_FILE:-.github/affected-paths.yml}"
# Pathspecs (`:(glob)`, ancorados na raiz) que marcam tudo como afetado. Testados por
# .github/scripts/affected.test.sh.
global_pathspecs=(
  ':(glob).github/workflows/**'
  ':(glob).github/actions/**'
  ':(glob).github/scripts/**'
  ":(glob)${config}"
  ':(glob)turbo.json'
  ':(glob)package.json'
  ':(glob)pnpm-workspace.yaml'
  ':(glob)pnpm-lock.yaml'
  ':(glob)tsconfig*.json'
  ':(glob)biome.json'
  ':(glob)knip.json'
  ':(glob)lefthook.yml'
  ':(glob).semgrep/**'
  ':(glob)sonar-project.properties'
  ':(glob)tools/vercel-cli/**'
  ':(glob)tools/netlify-cli/**'
)
path_groups=(ingest rag llm)
keys=(web api shared ingest rag llm)

declare -A result
for key in "${keys[@]}"; do
  result[$key]=false
done

mark_all() {
  for key in "${keys[@]}"; do
    result[$key]=true
  done
}

# Padrões de cada grupo por caminho, validados sempre (inclusive quando tudo já está afetado),
# para que um PR que quebre o arquivo de grupos falhe no próprio PR.
declare -A group_patterns
for group in "${path_groups[@]}"; do
  raw_patterns="$(yq -e ".${group}[]" "$config")"
  patterns=''
  while IFS= read -r pattern; do
    pattern="${pattern%$'\r'}"
    [[ -n "$pattern" ]] && patterns+="${pattern}"$'\n'
  done <<<"$raw_patterns"
  if [[ -z "$patterns" ]]; then
    echo "::error title=affected::Grupo '${group}' sem padrões em ${config}."
    exit 1
  fi
  group_patterns[$group]="$patterns"
done

base=''
case "${EVENT_NAME:?EVENT_NAME é obrigatório}" in
  pull_request)
    base="origin/${BASE_REF:?BASE_REF é obrigatório em pull_request}"
    ;;
  push)
    if [[ -n "${BEFORE_SHA:-}" && ! "${BEFORE_SHA}" =~ ^0+$ ]]; then
      base="${BEFORE_SHA}"
    fi
    ;;
esac

base_ok=false
if [[ -z "$base" ]]; then
  echo "::notice title=affected::Evento '${EVENT_NAME}' sem base comparável; tudo é considerado afetado."
elif ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  echo "::warning title=affected::Base '${base}' não encontrada no clone; tudo é considerado afetado."
else
  base_ok=true
fi

# Fora de um `if`/`[[ ]]` para que uma falha do git derrube o script (set -e) em vez de virar
# "nada mudou".
global_changed=''
if [[ "$base_ok" == true ]]; then
  global_changed="$(git diff --name-only "${base}...HEAD" -- "${global_pathspecs[@]}")"
fi

if [[ "$base_ok" != true ]]; then
  mark_all
elif [[ -n "$global_changed" ]]; then
  echo "::notice title=affected::Configuração de CI ou da raiz mudou; tudo é considerado afetado:"
  echo "$global_changed"
  mark_all
else
  # Pacotes JS: o turbo resolve dependentes, lockfile e globalDependencies.
  turbo_json="$(pnpm exec turbo query affected --packages --base "$base" --head HEAD)"
  if ! jq -e '(.errors // []) | length == 0' >/dev/null <<<"$turbo_json"; then
    echo "::error title=affected::turbo query affected retornou erros:"
    jq '.errors' <<<"$turbo_json"
    exit 1
  fi
  names="$(jq -r '.data.affectedPackages.items[].name' <<<"$turbo_json")"
  while IFS= read -r name; do
    name="${name%$'\r'}"
    case "$name" in
      @teko/web) result[web]=true ;;
      @teko/api) result[api]=true ;;
      @teko/shared) result[shared]=true ;;
    esac
  done <<<"$names"

  # Grupos por caminho (a mudança da própria definição já caiu no mark_all acima).
  for group in "${path_groups[@]}"; do
    pathspecs=()
    while IFS= read -r pattern; do
      [[ -n "$pattern" ]] && pathspecs+=(":(glob)${pattern}")
    done <<<"${group_patterns[$group]}"
    group_changed="$(git diff --name-only "${base}...HEAD" -- "${pathspecs[@]}")"
    if [[ -n "$group_changed" ]]; then
      result[$group]=true
    fi
  done
fi

packages=false
if [[ "${result[web]}" == true || "${result[api]}" == true || "${result[shared]}" == true ]]; then
  packages=true
fi

json="$(
  jq -cn \
    --argjson web "${result[web]}" \
    --argjson api "${result[api]}" \
    --argjson shared "${result[shared]}" \
    --argjson ingest "${result[ingest]}" \
    --argjson rag "${result[rag]}" \
    --argjson llm "${result[llm]}" \
    --argjson packages "$packages" \
    '{web: $web, api: $api, shared: $shared, ingest: $ingest, rag: $rag, llm: $llm, packages: $packages}'
)"

output="${GITHUB_OUTPUT:-/dev/stdout}"
{
  for key in "${keys[@]}"; do
    echo "${key}=${result[$key]}"
  done
  echo "packages=${packages}"
  echo "json=${json}"
} >>"$output"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Escopo afetado"
    echo
    echo "Base: \`${base:-nenhuma (tudo afetado)}\`"
    echo
    echo "| Grupo | Afetado |"
    echo "|---|---|"
    for key in "${keys[@]}"; do
      echo "| ${key} | ${result[$key]} |"
    done
  } >>"$GITHUB_STEP_SUMMARY"
fi
