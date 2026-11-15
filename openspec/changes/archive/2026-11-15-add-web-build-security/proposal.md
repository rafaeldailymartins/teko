# Proposal

## Why

O DoD da F5 pede que o build do web gere só estático, com headers e CSP gerados no build, 404 por
locale, redirect por idioma e orçamento de bundle total (`docs/roadmap.md`). Até a F4, o guard do
export olhava só o `middleware-manifest.json` no CI, a CSP do estático era parcial (sem
`script-src`, porque dependia do HTML) e não havia orçamento de bundle. O Caddy da stack de CI
servia o export sem headers, sem 404 por locale e sem o redirect por idioma, então o e2e não
conferia a semântica da Vercel.

## What Changes

- Pós-build do web (`apps/web/scripts/postbuild.ts`, parte do `build`): guard do estático puro no
  código e no resultado do build, manifesto `out/.teko-headers.json` com a CSP por documento
  (sha256 dos `<script>` e `<style>` inline, teto de 6 KB) e o Trusted Types report-only, e o
  orçamento do JS do primeiro acesso (`apps/web/bundle-budget.json`).
- `policy.ts` do site estático: valida o manifesto, sai a CSP parcial, `Permissions-Policy` mais
  restritiva. A Vercel (`build-vercel-output`), o Plano B (`static-site.ts`) e o Caddy da stack de CI
  (`scripts/caddy-static-site.ts`) aplicam a CSP por documento, inclusive nas páginas de 404.
- O Caddy da stack de CI ganha a semântica inteira das rotas da Vercel (headers, redirect da raiz
  por `Accept-Language`, `/pt-br`, barra final, 404 por locale, `/_next/static/*` imutável).
- E2E `apps/web/e2e/platform.spec.ts`: `/en/xyz` responde 404 em inglês; headers e CSP numa página;
  nenhuma violação de CSP aplicada.
- O passo de guard do job `build` do CI passa a rodar o pós-build.

## Capabilities

### New Capabilities

- `web-build`: build estático, headers e CSP por documento, rotas de plataforma e orçamento de
  bundle.

## Impact

- Fase F5 (onda 1). ADR 0029 (mesma origem; a CSP por caminho prevista nas consequências) e ADR
  0002 (nenhuma dependência nova: o `htmlparser2` 12.0.0 já está no catálogo e entra no
  `apps/web`).
- `apps/web` (scripts, `package.json`, `tsconfig.json`, `vitest.config.ts`, e2e),
  `apps/api/src/adapters/in/http/static-site`, `scripts/build-vercel-output.ts`,
  `scripts/caddy-static-site.ts`, `infra/ci` (Caddyfile, compose, up.sh), `.github/workflows/ci.yml`,
  `knip.json`, `.gitignore` e `docs/architecture/frontend.md`.
- Fora de escopo: o destino dos relatórios de CSP (`report-to`, F6), o enforce do Trusted Types
  (depois da v0.1.0), Lighthouse CI e orçamentos por rota (depois da v0.1.0) e o deploy (F7).
