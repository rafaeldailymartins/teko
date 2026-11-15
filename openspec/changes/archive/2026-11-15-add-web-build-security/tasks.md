# Tasks

## 1. Pós-build do web

- [x] 1.1 Guard do estático puro no código-fonte e no resultado do build
  (`apps/web/scripts/lib/static-guard.ts`; `static-guard.test.ts` e o código real sem violação)
- [x] 1.2 CSP por documento com htmlparser2, teto de 6 KB e manifesto `out/.teko-headers.json`
  (`csp.ts`, `html.ts` e testes; hash conferido contra o `out/` real em `test:scripts`)
- [x] 1.3 Orçamento do JS do primeiro acesso em `apps/web/bundle-budget.json`
  (`bundle-budget.test.ts`; `pnpm --filter @teko/web build` imprime a medição)
- [x] 1.4 `build` do web roda o pós-build; o job `build` do CI o repete depois do cache do turbo
  (actionlint e `bash .github/scripts/ci-config.test.sh`)

## 2. Quem serve o export

- [x] 2.1 `policy.ts`: `parseHeadersManifest`, `documentFileFor`, `documentPathPattern`, sem a CSP
  parcial (`static-site.test.ts`)
- [x] 2.2 Vercel: rotas por documento e 404 com CSP no `config.json`; manifesto fora do `static/`
  (`node --test scripts/build-vercel-output.test.ts`, simulador sem header repetido)
- [x] 2.3 Plano B: CSP pelo caminho e pelo 404; sem manifesto, o servidor não sobe
  (`static-site.test.ts`)
- [x] 2.4 Caddy da stack de CI: snippets gerados de `policy.ts` e do manifesto, `up.sh` e compose
  (`node --test scripts/caddy-static-site.test.ts`; Caddy real conferido com curl)

## 3. E2E e documentação

- [x] 3.1 `apps/web/e2e/platform.spec.ts`: 404 de `/en/xyz` em inglês, redirect da raiz, headers,
  CSP e nenhuma violação aplicada (rodado contra um Caddy local com o export real; no CI, job
  `e2e`)
- [x] 3.2 `docs/architecture/frontend.md` (pós-build, manifesto, `report-to` até a F6, orçamento)
