# Proposal

## Why

O mantenedor decidiu em 2026-11-18 que não haverá Plano B no Render (ADR 0039). O serviço
`teko-api-planb` nunca foi criado, mas deixou no código e nas specs um terceiro perfil de plataforma
(`RUNTIME_TARGET=render`), a variável `TRUST_PROXY` obrigatória só para ele, o plugin que fazia a
API servir o export do web (`WEB_STATIC_DIR`, `@fastify/static`) e cenários que citam o Render. É código sem uso que ainda precisa de teste, revisão e atualização de dependência.

## What Changes

- **Perfis de plataforma:** `RUNTIME_TARGET` passa a aceitar só `vercel` e `node`. Em staging e
  produção, o único valor válido é `vercel` (a mensagem do boot diz só "Vercel").
- **`TRUST_PROXY` sai:** o `trustProxy` vem sempre do perfil (1 salto na Vercel, a rede do Caddy no
  `node`, só em development e ci). Nenhum perfil restante lia a variável.
- **Sai o site estático na API:** o plugin `static-site` e a variável `WEB_STATIC_DIR`, o fallback de
  404 do error handler e a dependência `@fastify/static` (do `package.json` e do catálogo).
- **A política do estático fica nos scripts:** o antigo `static-site/policy.ts` da API passa a ser
  `scripts/lib/static-site-policy.ts`, fonte única das rotas da Vercel (`build-vercel-output.ts`) e
  dos snippets do Caddy da stack de CI (`caddy-static-site.ts`), com os testes em `node:test`.
- **Specs:** os requisitos de headers do estático, da raiz em desenvolvimento, da drenagem e das
  variáveis da ingestão deixam de citar o Plano B e o Render.
- `infra/planb-render/` sai do repositório.

## Capabilities

### Modified Capabilities

- `web-build`: os headers e as rotas do estático valem na Vercel e no Caddy da stack de CI; o teste
  da raiz em desenvolvimento compara com `scripts/lib/static-site-policy.ts`.
- `question-answering`: a drenagem passa a ser a do processo Node (o requisito citava o Render).
- `corpus-ingestion`: o cenário das credenciais da ingestão usa `RUNTIME_TARGET=vercel`.

## Impact

- `apps/api`: `config/env.ts`, `config/platform.ts`, `build-app.ts`, `composition-root.ts`,
  `http-options.ts`, `problem/error-handler.ts`, comentários dos adapters e das portas, `.env.example`,
  `Dockerfile`, `.vercelignore`, `tsdown.config.ts`, `package.json` e os testes de env, plataforma,
  raiz de composição e integração.
- `scripts/`: `build-vercel-output.ts`, `caddy-static-site.ts`, `root-locale.test.ts` e os testes
  passam a importar `scripts/lib/static-site-policy.ts`.
- `pnpm-workspace.yaml` e `pnpm-lock.yaml` sem o `@fastify/static`.
- Docs: ADR 0039 e notas nas ADRs que citavam o Plano B, roteiro, status, arquitetura, READMEs,
  `SECURITY.md`, `CLAUDE.md` e runbooks.
- Fase: transversal, antes da F7 (o ensaio do Plano B saía do DoD da F7).
- Fora de escopo: os runbooks e workflows da F7 (`vercel-paused.md`, `budget-kill-switch.md`,
  `deploy.yml`, smoke, `vercel-usage`), que outras mudanças escrevem.
