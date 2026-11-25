## ADDED Requirements

### Requirement: Cold start sem o que o health check não usa

Na Vercel, o boot da Function MUST NOT carregar o Better Auth, o AI SDK, o `posthog-node`, o
migrator do Drizzle nem a documentação OpenAPI: cada um SHALL entrar por `import()` no primeiro
uso, atrás da mesma porta, e o dependency-cruiser MUST barrar o import estático deles. Fora da
Vercel, os SDKs SHALL carregar antes da porta abrir. O Fastify MUST nascer com os compilers Zod.

#### Scenario: Instância nova que só atende o health check

- **WHEN** uma instância nova da Function sobe e atende só `GET /healthz`
- **THEN** a resposta é a de sempre (`status`, `version`, `gitSha`, `env`) e nenhum dos SDKs acima é carregado

#### Scenario: Primeira requisição de autenticação

- **WHEN** a primeira requisição de `/api/auth/*` ou com sessão chega a uma instância
- **THEN** o Better Auth é importado e instanciado uma vez, e as requisições seguintes da instância usam a mesma instância

#### Scenario: Processo de vida longa fora da Vercel

- **WHEN** a API sobe com `RUNTIME_TARGET=node` (stack de CI, Docker, `pnpm dev`), com o `under-pressure` medindo o event loop
- **THEN** Better Auth, AI SDK e `posthog-node` carregam antes de abrir a porta, e nenhuma requisição recebe 503 pela carga deles

#### Scenario: Import estático de volta

- **WHEN** um módulo de `apps/api/src` fora dos testes importa `better-auth.ts`, `ai-sdk-llm.ts`, `migrate.ts`, `posthog-node`, `@fastify/swagger` ou `@scalar/fastify-api-reference` sem `import()`
- **THEN** o `pnpm lint:deps` falha com a regra `cold-start-sdks-only-by-dynamic-import`
