# Tasks

## 1. Contrato

- [x] 1.1 `normalizeWebOpenApi` e `serializeOpenApi` (prefixo `/api` em `servers`, versão fixa, ordem estável)
- [x] 1.2 `exportWebOpenApi` no composition root e subcomando `cli openapi export`
- [x] 1.3 `apps/web/openapi.json` versionado e `openapi-ts.config.ts`
- [x] 1.4 Cliente gerado em `src/lib/api/__generated__/` e `pnpm --filter @teko/web api:generate`
- [x] 1.5 Gate `pnpm api:check` no `verify` e no job `lint` do CI, com teste em `ci-config.test.sh`

## 2. Camada de dados

- [x] 2.1 `ApiError` e `toApiError` (Problem Details, status HTTP e falha de rede) e interceptor
- [x] 2.2 `createQueryClient` (`staleTime: 60_000`, retry só de erro transitório)
- [x] 2.3 Data de referência na URL e nas keys (`reference.ts`) e parsers do nuqs (`url-state.ts`)
- [x] 2.4 Options de consulta (`queries.ts`) e hooks (`hooks.ts`)
- [x] 2.5 `Providers` (TanStack Query e nuqs) no `locale-layout.tsx`

## 3. Fechamento

- [x] 3.1 Testes sem rede (fetch simulado e render de servidor) e mensagem `errors.<code>` por código
- [x] 3.2 `frontend.md` e `status.md`
