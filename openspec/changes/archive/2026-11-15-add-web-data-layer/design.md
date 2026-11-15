# Design

## Context

Desenho em `docs/architecture/frontend.md` (Dados e streaming). A API já publica o OpenAPI 3.1 dos
schemas Zod em `/api/docs/json` fora de produção (`plugins/openapi.ts`). O web é export estático: tudo
roda no navegador, na mesma origem da API (ADR 0029). Esta mudança é a onda 1 da F5; o transporte do
chat (`chat-transport.ts`) e toda a UI ficam para as ondas seguintes.

## Decisions

- **Export pela CLI da API, sem servidor.** `exportWebOpenApi` (composition root) monta a app com um
  env fixo de desenvolvimento (sem banco, sem ler `process.env`), pede `/api/docs/json` por `inject` e
  normaliza. Subcomando `cli openapi export [--out]`, atalho `pnpm --filter @teko/api openapi:export`.
  Reaproveita o mesmo documento do Scalar e do ZAP, sem segundo gerador.
- **Arquivo em `apps/web/openapi.json`.** É o insumo do codegen do web, que é o único consumidor; fica
  ao lado do `openapi-ts.config.ts`. No `packages/shared` ele viraria um artefato da API dentro do
  pacote de contratos, que é a fonte (Zod) e não o derivado. Fora do Biome (arquivo gerado de 200 KB;
  o formatador reescreveria o JSON e o gate de drift brigaria com ele) por `!**/openapi.json`: o
  `apps/web/biome.json` aninhado resolve os `includes` a partir do próprio diretório, então um
  caminho a partir da raiz não casaria. O jscpd já ignora `*.json`.
- **Normalização para o `baseUrl: '/api'`.** As rotas são registradas como `/api/v1/...`. O documento
  da web leva os caminhos sem o prefixo e `servers: [{ url: '/api' }]`, de onde o hey-api tira o
  `baseUrl` do cliente; `/healthz` (fora de `/api`) sai. `info.version` é fixo (`v1`) e caminhos e
  métodos ficam em ordem de code units: o arquivo só muda quando muda o contrato.
- **Cliente gerado sem formatador e com `// @ts-nocheck`.** `@hey-api/openapi-ts` 0.99 com
  `@hey-api/client-fetch`, `@hey-api/typescript`, `@hey-api/sdk` e `@tanstack/react-query`
  (`queryOptions`, `queryKeys`, `mutationOptions`). O runtime embutido do client-fetch não compila com
  `exactOptionalPropertyTypes`; o cabeçalho `// @ts-nocheck` (opção `output.header`) desliga só os
  erros internos do gerado, e os tipos continuam valendo para quem importa. `__generated__` já fica
  fora do Biome, do jscpd e da cobertura; o knip ignora a pasta (exports do SDK sem uso ainda).
- **Gate de drift sem pnpm aninhado.** `scripts/check-api-client.ts` roda a CLI da API e o bin do
  `openapi-ts` com `process.execPath` e confere `git status --porcelain --untracked-files=all` nos
  dois caminhos (pega arquivo alterado, novo e apagado, o que `git diff --exit-code` sozinho não pega
  em arquivo novo). Entra no `pnpm verify` e no job `lint` do CI, com `HAS_CODE`: PR só de docs não o
  roda. O `lint` já roda em todo PR com código, então uma mudança só no `@teko/shared` também cai nele.
- **`ApiError` por interceptor.** O client-fetch lança o corpo cru do erro (JSON ou texto) ou a
  exceção do `fetch`. Um interceptor de erro no cliente único (`client.ts`) troca isso por `ApiError`
  com `code`, `status`, `retryable`, `traceId`, `quota` e `messageKey` (`errors.<code>`). As options
  passam `client: apiClient` explicitamente, o que garante o interceptor registrado sem import com
  efeito colateral. O `Register` do TanStack Query declara `defaultError: ApiError`.
- **Retry.** Até 2 tentativas extras só para erro `retryable`, menos `quota_exceeded` e `rate_limited`
  (passam mais tarde, mas repetir na hora só gasta a janela). Mutações não repetem.
- **Keys com a data de referência.** As keys são as geradas (incluem `path` e `query`). Onde a
  resposta depende da data (`searchProvisions`, `getProvisionDiff`), a data efetiva vai sempre na
  query (`at`, `from`, `to`), então entra na key; o período resolve para o dia 1, como na API, e
  `2024-03` e `2024-03-01` dividem a entrada. Sem `at`, a API usaria "hoje" e a key não mudaria com a
  data escolhida.
- **Options e hooks separados.** `queries.ts` expõe as options (`meQuery`, `historyQuery`...) para
  invalidar, pré-carregar e semear o cache; `hooks.ts` é um `useQuery` sobre cada uma. Parâmetro
  `null` vira `skipToken` (tipado, sem `enabled`). O knip do repositório conta o uso em teste (modo não
  production), então os hooks sem tela ainda entram cobertos por teste.
- **`useHistory` por conversa.** A API lista o histórico por `conversationId` (`GET /questions`); não
  há rota de lista de conversas, então o hook recebe a conversa.
- **nuqs.** Adapter `nuqs/adapters/next/app` no `Providers`; parsers `q` e `c` (UUID pelo `idSchema`)
  e `ref` (período ou data pelos schemas de `@teko/shared/vigencia`) em `src/lib/url-state.ts`, com
  `eq` por valor. O componente que usar `useQueryStates` precisa de `<Suspense>` no export estático.
- **Provider mínimo.** `src/components/providers.tsx` só tem `QueryClientProvider` e `NuqsAdapter`, um
  `QueryClient` por montagem (`useState`), para o merge com o shell da onda 1 ser simples.

## Risks / Trade-offs

- `// @ts-nocheck` esconde um erro de tipo dentro do gerado; a cobertura vem dos testes da camada
  (fetch simulado de ponta a ponta) e do typecheck de quem consome os tipos.
- O documento inlina o schema de Problem Details em cada resposta de erro (200 KB). Registrar os
  schemas Zod com `id` para virarem `components` reduziria o arquivo; fica como está enquanto o
  tamanho não pesa no codegen.

## Context7

- `/hey-api/hey-api`: `defineConfig`, plugins `@hey-api/client-fetch`, `@hey-api/sdk` e
  `@tanstack/react-query` (`queryOptions`, `queryKeys`), `baseUrl` a partir de `servers`,
  `output.header` e `runtimeConfigPath`.
- `/tanstack/query`: `QueryClient` com `defaultOptions`, `QueryClientProvider`, `skipToken`,
  `Register.defaultError`.
- `/47ng/nuqs`: `NuqsAdapter` do App Router, `createParser` (`parse`, `serialize`, `eq`),
  `useQueryStates`, `isParserBijective` (`nuqs/testing`) e a exigência de `<Suspense>`.
