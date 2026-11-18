# Proposal

## Why

A F7 publica staging e produção na Vercel, e a configuração dos projetos que é versionável
(`infra/vercel/env.*.json` e `infra/vercel/firewall-rules.json`) ainda é aplicada à mão: as Config
foram gravadas no spike da F1 e as regras do WAF, pelo mantenedor em 2026-11-13. Sem automação, um
deploy pode subir com uma Sensitive faltando, com a Config defasada ou com o WAF diferente do
repositório. O `/healthz` também responde `gitSha: unknown` na Vercel, porque nada leva o commit à
Function, e o smoke não tem como provar que o domínio serve o artefato atestado. O guarda de uso da
F7 precisa ainda de um jeito versionado de fechar a API (lockdown) a 95% de uma cota.

## What Changes

- `scripts/lib/vercel-api.ts`: cliente REST mínimo da Vercel (token, `teamId`, ids constantes dos
  projetos, erros sem corpo), reaproveitável pelo guarda de uso.
- `scripts/vercel-env-sync.ts --env staging|production [--dry-run]`: aplica a Config do JSON
  (cria ou edita só o que mudou, tipo não sensível), falha antes de escrever se faltar Sensitive
  obrigatória para a fase, nunca toca `LLM_KILL_SWITCH`, recusa `GIT_SHA`/`APP_VERSION` no projeto e
  nunca imprime valores.
- `scripts/vercel-firewall.ts --env staging|production [--lockdown on|off] [--dry-run]`: aplica as 3
  regras de `firewall-rules.json` por nome, de forma idempotente; `--lockdown on|off` troca a regra 1
  pelo payload `lockdown` versionado no mesmo JSON; o sync sem `--lockdown` mantém um lockdown ativo.
- `scripts/build-vercel-output.ts`: com `GIT_SHA` (ou `GITHUB_SHA`) e `APP_VERSION`, grava os dois no
  `environment` do `.vc-config.json`, para o tarball atestado carregar a identidade do commit.
- `infra/vercel/firewall-rules.json`: payload `lockdown` por projeto.
- Testes no `pnpm test:scripts`.

## Capabilities

### New Capabilities

- `deployment`: configuração dos projetos Vercel aplicada por código (env vars, WAF e lockdown) e a
  identidade do commit no artefato.

### Modified Capabilities

Nenhuma.

## Impact

- `scripts/lib/vercel-api.ts`, `scripts/vercel-env-sync.ts`, `scripts/vercel-firewall.ts`,
  `scripts/build-vercel-output.ts` e os testes.
- `infra/vercel/firewall-rules.json` e `infra/vercel/README.md`.
- Nenhuma mudança na API: o `/healthz` já devolve `gitSha` (`healthResponseSchema`).

Fase: F7. ADRs: 0017 (o `.vc-config.json` ganha `environment`) e 0029. O pipeline que chama os
scripts é a mudança `add-deploy-pipelines`.
