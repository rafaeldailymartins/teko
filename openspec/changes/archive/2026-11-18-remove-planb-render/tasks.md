# Tasks

## 1. API

- [x] 1.1 `RuntimeTarget` só com `node` e `vercel`; staging e produção exigem `vercel`; sai a
  `TRUST_PROXY` (verificar: `env.test.ts` e `platform.test.ts` verdes)
- [x] 1.2 Sai o plugin `static-site`, a `WEB_STATIC_DIR`, o fallback de 404 do error handler e o
  `@fastify/static` do `package.json` e do catálogo, com o lockfile refeito (verificar:
  `pnpm install`, `knip` e `test:unit` verdes)
- [x] 1.3 Testes de integração sem o perfil do Render (verificar: `app.test.ts` no
  `pnpm test:integration`)

## 2. Política do estático

- [x] 2.1 `policy.ts` vira `scripts/lib/static-site-policy.ts`, importado por
  `build-vercel-output.ts`, `caddy-static-site.ts` e `root-locale.test.ts`, com os testes em
  `static-site-policy.test.ts` (verificar: `pnpm test:scripts`)

## 3. Infra e documentos

- [x] 3.1 `infra/planb-render/` sai; comentários de `apps/web`, `scripts`, `.github`, `.semgrep` e
  `packages/shared` sem o Plano B (verificar: `git grep -i "planb\|plano b\|onrender"` só acha o
  histórico)
- [x] 3.2 ADR 0038 e notas nas ADRs que citavam o Plano B; roteiro, status, arquitetura, READMEs,
  `SECURITY.md`, `CLAUDE.md` e runbooks (verificar: revisão do diff)

## 4. Specs

- [x] 4.1 Deltas de `web-build`, `question-answering` e `corpus-ingestion` (verificar:
  `pnpm spec:validate`)
