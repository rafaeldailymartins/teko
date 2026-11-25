## ADDED Requirements

### Requirement: Cold start sem o que o health check não usa

O boot da Function MUST NOT carregar o Better Auth, o AI SDK, o `posthog-node`, o migrator do
Drizzle nem a documentação OpenAPI: cada um SHALL entrar por `import()` no primeiro uso, atrás da
mesma porta, e o dependency-cruiser MUST barrar o import estático deles. O Fastify MUST nascer com
os compilers Zod. O CPU do cold start SHALL ser medível por `scripts/measure-cold-start.ts`.

#### Scenario: Instância nova que só atende o health check

- **WHEN** uma instância nova da Function sobe e atende só `GET /healthz`
- **THEN** a resposta é a de sempre (`status`, `version`, `gitSha`, `env`) e nenhum dos SDKs acima é carregado

#### Scenario: Primeira requisição de autenticação

- **WHEN** a primeira requisição de `/api/auth/*` ou com sessão chega a uma instância
- **THEN** o Better Auth é importado e instanciado uma vez, e as requisições seguintes da instância usam a mesma instância

#### Scenario: Import estático de volta

- **WHEN** um módulo de `apps/api/src` fora dos testes importa `better-auth.ts`, `ai-sdk-llm.ts`, `migrate.ts`, `posthog-node`, `@fastify/swagger` ou `@scalar/fastify-api-reference` sem `import()`
- **THEN** o `pnpm lint:deps` falha com a regra `cold-start-sdks-only-by-dynamic-import`
