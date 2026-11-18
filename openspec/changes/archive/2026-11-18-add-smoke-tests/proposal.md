# Proposal

## Why

A F7 publica o Tekó de verdade, e o deploy precisa de uma prova barata de que a deployment nova
responde como a arquitetura manda antes e depois do `promote`, e de uma jornada real no staging que
segure o release (`staging-verified`). Hoje não há smoke nem system test: um header de segurança
perdido, a CDN cacheando `/api`, o WAF desligado, o domínio antigo sem 308 ou a URL única sem
Deployment Protection só apareceriam com um usuário. O roteiro (F7, "Passkey do system test") também
pede o caminho no código para o login por passkey do usuário de teste. É a mudança
`add-smoke-tests` da F7.

## What Changes

- `scripts/smoke.ts`: smoke HTTP sem dependências, com contrato fixo
  (`--env staging|production --mode deployment|canonical --base-url <url> --expected-sha <40 hex>
  [--out <arquivo.json>]`, saídas 0/1/2). Modo `deployment` contra a URL única com o bypass de
  automação da Vercel (header `x-vercel-protection-bypass`, segredo só do env), conferindo também que
  a URL sem bypass não chega à API; modo `canonical` contra o `WEB_ORIGIN` do ambiente, somando WAF e
  domínio antigo, com retry curto só no `/healthz` enquanto o `gitSha` for o da deployment anterior.
  Relatório JSON com status, tentativas e tempo de cada checagem.
- `.github/workflows/smoke.yml`: smoke canônico por `workflow_call` e `workflow_dispatch` (inputs
  `environment` e `expected-sha`), sem environment nem segredo.
- System test: projeto Playwright separado (`apps/web/playwright.system.config.ts`,
  `apps/web/system/`) contra o staging, com login por passkey num autenticador virtual do Chromium
  (CDP `WebAuthn`), 1 pergunta de um pool versionado de 30, cache, recusa fora da cobertura e troca
  de idioma; `.github/workflows/system-test.yml` (environment `staging`, só `main`, segredo
  `SYSTEM_TEST_PASSKEY`, pulado com aviso sem ele).
- `apps/web/system/register-passkey.ts`: o mantenedor registra a passkey do usuário de teste pela
  tela real e manda a credencial exportada direto para o `gh secret set`; runbook
  `docs/runbooks/system-test.md`.
- E2E `apps/web/e2e/passkey.spec.ts`: o mesmo caminho da passkey (cadastrar, exportar, importar e
  entrar) na stack de CI, em todo PR que toca web ou API.
- Docs: `ci-cd-e-ambientes.md` (Smoke e System test com os nomes reais) e `qualidade-e-seguranca.md`
  (matriz de testes); invariantes dos dois workflows no `ci-config.test.sh`.
- Fora de escopo: ligar o smoke e o system test no `deploy.yml` (mudança `add-deploy-pipelines`, que
  chama os dois pelos contratos daqui) e registrar a passkey no staging (tarefa do mantenedor).

## Capabilities

### New Capabilities

- `deploy-verification`: smoke HTTP de cada deployment (URL única e domínio canônico) e system test
  do staging com o usuário de teste entrando por passkey.

### Modified Capabilities

- Nenhuma.

## Impact

- Nenhuma dependência nova: o smoke usa só o Node 24; o system test usa o `@playwright/test` que o
  e2e já tem.
- Segredo novo `SYSTEM_TEST_PASSKEY` no environment `staging` (o mantenedor grava; o system test
  pula sem ele). O smoke de deployment lê o `VERCEL_AUTOMATION_BYPASS_SECRET` que o environment já
  tem.
- Cada system test gasta no máximo 2 gerações de LLM e algumas leituras no Neon do staging; o smoke
  não gera e faz uma leitura de cobertura por instância.
