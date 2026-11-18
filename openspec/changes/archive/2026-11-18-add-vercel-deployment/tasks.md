# Tasks

## 1. Cliente da Vercel

- [x] 1.1 `scripts/lib/vercel-api.ts` (credenciais, ids constantes, erro sem corpo, conferência do
  projeto) com testes (verificar: `node --test scripts/lib/vercel-api.test.ts`)

## 2. Env vars

- [x] 2.1 `scripts/vercel-env-sync.ts` com `--env` e `--dry-run`; Sensitive faltando falha antes de
  escrever; Config criada ou editada só quando muda; `LLM_KILL_SWITCH`, `GIT_SHA` e `APP_VERSION`
  recusados; nenhum valor no log (verificar: `node --test scripts/vercel-env-sync.test.ts`)

## 3. WAF

- [x] 3.1 Payload `lockdown` por projeto em `infra/vercel/firewall-rules.json`
- [x] 3.2 `scripts/vercel-firewall.ts` com `--env`, `--lockdown on|off` e `--dry-run`; sync por nome;
  lockdown ativo mantido no sync; saídas no `GITHUB_OUTPUT` (verificar:
  `node --test scripts/vercel-firewall.test.ts`)

## 4. Identidade do commit

- [x] 4.1 `scripts/build-vercel-output.ts` grava `GIT_SHA` e `APP_VERSION` no `environment` do
  `.vc-config.json` (verificar: `node --test scripts/build-vercel-output.test.ts`)

## 5. Docs e gates

- [x] 5.1 `infra/vercel/README.md` (env sync, firewall, lockdown e identidade)
- [x] 5.2 `pnpm verify:full` verde; mudança arquivada com
  `pnpm exec openspec archive add-vercel-deployment --yes`
