# Tasks

## 1. Web

- [x] 1.1 Página `src/app/aviso/page.tsx` com `lockdown-notice-page.tsx` (`BareDocument`, os dois
  idiomas lado a lado, `noindex`, título nos dois idiomas) e o namespace `lockdown` nos dois
  catálogos (verificar: `vitest run src/components/locale-gateway src/lib/i18n`)
- [x] 1.2 Axe da página nos dois temas em `e2e/a11y.spec.ts`

## 2. Build e WAF

- [x] 2.1 `aviso/index.html` em `REQUIRED_STATIC_FILES` do `build-vercel-output.ts`, com os testes
  da página servida com a CSP do documento e do build sem ela (verificar:
  `node --test scripts/build-vercel-output.test.ts`)
- [x] 2.2 Payload `lockdown` dos dois projetos com `redirect` para `/aviso/` (`permanent: false`) e a
  exceção só da raiz; `vercel-firewall.ts` recusa lockdown sem esse redirect (verificar:
  `node --test scripts/vercel-firewall.test.ts`)
- [x] 2.3 Build do web e `build-vercel-output` local: `aviso/index.html` no
  `.vercel/output/static` (sem deploy)

## 3. Docs

- [x] 3.1 `budget-kill-switch.md` (95% e o exercício no staging), `infra/vercel/README.md`,
  `contas-e-cotas.md`, `frontend.md`, os runbooks que citam o lockdown e a nota do painel
  `vercel-hobby.json`

## 4. Gates

- [x] 4.1 `pnpm verify`, `pnpm test:scripts` e `pnpm spec:validate`
