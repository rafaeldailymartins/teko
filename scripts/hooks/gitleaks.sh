#!/usr/bin/env sh
# Hook pre-commit (lefthook): varre o que está staged em busca de segredos.
# Fica num script porque o lefthook no Windows quebra comandos inline com aspas ou várias linhas.
# gitleaks é um binário (não pacote npm); sem ele, só avisa: o CI (security.yml) roda de qualquer forma.
# Um vazamento encontrado sai com o código do gitleaks (≠ 0) e bloqueia o commit.
set -eu

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --no-banner
fi

echo "gitleaks ausente: instale-o para varrer segredos localmente (o CI roda de qualquer forma)" >&2
