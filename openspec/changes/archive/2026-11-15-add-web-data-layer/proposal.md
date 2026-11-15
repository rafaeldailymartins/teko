# Proposal

## Why

A F5 constrói a UI do chat, do histórico, da cobertura e das citações sobre a API. Sem uma camada de
dados comum, cada tela escreveria o próprio `fetch`, o próprio tratamento de erro e a própria chave
de cache, e o contrato com a API só quebraria em produção. O roteiro pede cliente gerado do OpenAPI
com gate de drift no CI, TanStack Query com keys que levam a data de referência, uma mensagem
`errors.<code>` para cada `ErrorCode` e estado do chat na query string (o export estático não tem
rotas dinâmicas).

## What Changes

- OpenAPI 3.1 versionado em `apps/web/openapi.json`, gerado pela CLI da API (`cli openapi export`,
  `pnpm --filter @teko/api openapi:export`) sem servidor nem banco, determinístico.
- Cliente `@hey-api/openapi-ts` (client-fetch com `baseUrl: '/api'`, SDK e plugin do TanStack
  Query) em `apps/web/src/lib/api/__generated__/`, com `pnpm --filter @teko/web api:generate`.
- Gate de drift `pnpm api:check` (`scripts/check-api-client.ts`) no `pnpm verify` e no job `lint`
  do CI.
- `QueryClient` com `staleTime: 60_000` e provider (`src/components/providers.tsx`) com o adapter
  do nuqs, plugado no layout de cada locale.
- `ApiError` (código fechado, `retryable`, `traceId`, cota) a partir de Problem Details, aplicado
  por interceptor do cliente.
- Parsers do nuqs para `q`, `c` e `ref` e hooks de leitura (`useMe`, `useCoverage`, `useHistory`,
  `useQuestion`, `useProvisionTimeline`, `useProvisionDiff`, `useProvisionSearch`).

## Capabilities

### New Capabilities

- `web-data`: camada de dados do web (contrato gerado, cache, erros e estado na URL).

## Impact

- `apps/api`: subcomando `openapi export` da CLI e `exportWebOpenApi` no composition root.
- `apps/web`: `src/lib/api/**`, `src/lib/url-state.ts`, `src/components/providers.tsx`,
  `locale-layout.tsx`, `openapi.json` e `openapi-ts.config.ts`.
- Raiz: `scripts/check-api-client.ts`, `verify`, `ci.yml` (job `lint`), `biome.json` e `knip.json`.
- Dependências: `@tanstack/react-query`, `nuqs` e `@hey-api/openapi-ts` (dev).
