# Design

## Context

A Vercel cobra "Fluid Active CPU" só enquanto o código roda, e o Hobby tem 4 h por mês na conta
(os dois projetos somados), sem compra de uso extra: passou disso, a conta é pausada ou desativada.
O Synthetic Monitoring chamava os dois `/healthz` a cada 5 min. Com esse intervalo a instância Fluid
esfria entre as chamadas, então cada execução era um cold start: o launcher importa o
`server.mjs`, que valida o env, sobe o SDK do OpenTelemetry, importa a raiz de composição, monta o
container e o app e só então atende. Em 2026-11-25 a conta foi desativada sem usuários reais.

## Medição

`scripts/measure-cold-start.ts` reproduz o launcher `Nodejs` da Vercel num processo filho novo por
execução: troca `http.Server.prototype.listen` por um interceptador, faz `import()` do `server.mjs`
da Function montada como no deploy (`pnpm --filter @teko/api build`, `pnpm deploy --prod` com
`node-linker=hoisted` e `scripts/build-vercel-output.ts`), chama o `listen` real numa porta efêmera
e manda um `GET /healthz`. Mede `process.cpuUsage()` (usuário + sistema) do começo do script do
filho até a resposta. O ambiente é o de `infra/vercel/env.production.json` (os `config` de lá e um
valor de mentira para cada `sensitive`, com os hosts em `.invalid`), mais `VERCEL=1`,
`VERCEL_REGION=gru1`, `GIT_SHA` e `APP_VERSION`; o filho confere 200 com `status: ok` e
`env: production`. Com `--cpu-prof`, cada filho grava um perfil do V8.

Mediana de 7 execuções na máquina do mantenedor (Windows 11, Node 24.18), no mesmo dia, com
`origin/main` e a branch montados do mesmo jeito:

| Bundle                  | Import (env, OTel, container, app) | Cold start completo | Faixa          |
| ----------------------- | ---------------------------------- | ------------------- | -------------- |
| `origin/main` (1f16c7c) | 5,11 s                             | 5,19 s              | 4,91 a 5,44 s  |
| esta mudança            | 2,52 s                             | 2,58 s              | 2,22 a 3,08 s  |
| esta mudança (repetição) | 2,63 s                            | 2,69 s              | 2,49 a 3,11 s  |

Redução de 48 a 50% no cold start (a repetição rodou com outros testes na máquina). O número absoluto é da máquina local: no Windows, abrir e ler os
cerca de 35 mil arquivos do `node_modules` pesa mais que no Linux da Vercel, que ainda guarda o
bytecode compilado das deployments de produção. Vale como teto e para comparar medições feitas na
mesma máquina.

O perfil do bundle antigo mostrou o tempo quase todo em carregar módulos (abrir, ler e compilar). Por
pacote, isolado: `better-auth` com a passkey (`@peculiar/x509`, `asn1js`) cerca de 1,5 s; o AI SDK
com os provedores cerca de 0,6 s; `@scalar/fastify-api-reference` 0,3 s; o migrator do Drizzle 0,3
s; `posthog-node` 0,25 s; o Ajv que o Fastify monta para o compiler padrão cerca de 0,35 s.

## Decisions

- **Carga sob demanda atrás das portas.** `lazyModule` (`adapters/out/lazy-module.ts`) guarda a
  promise do primeiro `import()` (chamadas concorrentes esperam a mesma; falha não fica em cache).
  - `AuthGateway`: `lazy-better-auth.ts` responde `methods` e `clearSessionCookies` a partir da
    configuração (`auth-config.ts`) e só importa e instancia o `better-auth.ts` no primeiro
    `handle` ou `getSession`.
  - `LlmModel`: `lazy-llm-chain.ts` monta a cadeia a partir de `chainIdentities` (a mesma ordem que
    o `ai-sdk-llm.ts` usa) e delega cada `stream` ao modelo de mesma posição da cadeia real, que
    abre o span `chat <modelo>` e converte os erros como antes; o router e os breakers não mudam.
  - `ErrorReporterPort`: o `posthog-node` entra no primeiro `report`; um processo sem erro nunca o
    carrega nem o encerra. O primeiro erro de uma instância soma o import (cerca de 0,1 a 0,3 s) ao
    envio, que já era assíncrono e fica dentro do mesmo `flush`.
  - Migrator do Drizzle (`migrateDatabase`, só a CLI) e os plugins da documentação OpenAPI (só fora
    de produção): `import()` dentro da função que os usa.
- **Fora da Vercel, tudo no boot.** Na stack de CI, no Docker e no `pnpm dev` o `under-pressure`
  mede o atraso do event loop e responde 503 acima de 1 s; importar o Better Auth no meio do tráfego
  passava disso (a integração `auth-email` recebeu 503 na primeira rodada). Os adapters sob demanda
  expõem `preload` (`Preloadable`), o `Container.warmUp` chama todos, e o `buildApp` o aguarda antes
  de montar o Fastify quando o guarda está ligado, ou seja, fora da Vercel, onde o processo vive e
  não paga Active CPU. Lá o comportamento é o de antes. Pelo mesmo motivo, com a documentação
  ligada (fora da produção) o `buildApp` carrega os plugins do OpenAPI antes de criar o Fastify.
- **Compilers Zod na criação do Fastify** (`schemaController.compilersFactory`). O
  `setValidatorCompiler` e o `setSerializerCompiler` já valiam para todas as rotas; sem a fábrica, o
  Fastify ainda carregava e montava o Ajv e o fast-json-stringify padrão. Os tipos do Fastify
  descrevem a fábrica com as assinaturas do Ajv, daí a conversão comentada em `build-app.ts`.
- **Guarda contra regressão:** a regra `cold-start-sdks-only-by-dynamic-import` do
  dependency-cruiser reprova import estático (não `import type`) dos módulos pesados fora dos
  testes. A medição fica como script, não como gate: o número depende da máquina.
- **Frequência dos checks.** O `/healthz` de produção vai para 60 min (o máximo do Synthetic
  Monitoring), o bastante para provar a Function viva; o de staging fica desligado (o smoke de cada
  deploy confere o `/healthz` do staging, e a pausa por cota é da conta, que a produção mostra). A
  landing segue a cada 15 min: é estática, não invoca a Function, e dá a disponibilidade da borda e
  o 503 de pausa (a pausa vale para a deployment inteira). A validação do Grafana as code reprova
  check ligado que invoca a Function (`/healthz` ou `/api/*`) com menos de 60 min.
- **Janela dos alertas.** Com um check de 60 min, a janela de 20 min do `teko-synthetic-failed`
  (e a de 10 min do `teko-deployment-paused`) ficaria sem amostra entre duas execuções, e o alerta
  dispararia e voltaria a Normal sozinho. As duas regras passam a olhar 65 min, e a validação
  reprova janela que não passa da frequência do check ligado mais lento. Custo: uma falha só da
  landing leva até 65 min para virar alerta (antes, 20); a pausa continua aparecendo na primeira
  execução com 503, agora de qualquer check.

## Conta de Active CPU

Premissa de pior caso: toda execução de `/healthz` acha a instância fria (com 5 min já esfriava; com
60 min, sempre). CPU por cold start: a mediana local acima, que é um teto para a Vercel.

| Cenário                                     | Cold starts/dia | CPU/cold start | CPU/dia | CPU/mês (30 dias)   | Fração das 4 h |
| ------------------------------------------- | --------------- | -------------- | ------- | ------------------- | -------------- |
| antes: 2 `/healthz` a cada 5 min, boot antigo | 576           | 5,19 s         | 2.989 s | 89.700 s (24,9 h)   | 623%           |
| só o boot novo, checks antigos              | 576             | 2,58 s         | 1.486 s | 44.600 s (12,4 h)   | 310%           |
| só os checks novos, boot antigo             | 24              | 5,19 s         | 125 s   | 3.740 s (1,04 h)    | 26%            |
| depois: 1 `/healthz` a cada 60 min, boot novo | 24            | 2,58 s         | 62 s    | 1.860 s (0,52 h)    | 13%            |

A redução dos checks é a que tira a conta do vermelho (24x menos invocações); a do boot corta pela
metade o que sobra e todo cold start de tráfego real, deploy, smoke e system test. Os deploys somam
pouco: cada um faz alguns cold starts (smoke, system test), da ordem de 10 s de CPU.

## Alternativas descartadas

- **Responder o `/healthz` antes de montar o app** (um `http.Server` próprio no `server.ts` que só
  delega ao Fastify fora do health check). O check deixaria de provar que a Function sobe: um env
  inválido ou uma falha na raiz de composição continuaria respondendo 200. O `/healthz` também
  perderia o pipeline (headers de segurança, `x-trace-id`, request id, métrica de duração).
- **Carregar o Langfuse e os exporters OTLP sob demanda** (cerca de 0,6 s no perfil, o maior pedaço
  que sobrou). O `LangfuseSpanProcessor` escreve atributos no `onStart` de todo span gravado, que é
  síncrono, e o pino manda os logs do próprio `/healthz` ao exporter de logs: adiar a carga mudaria
  o que chega ao Grafana e ao Langfuse. Fica para quando houver um gancho de "pronto" antes do
  primeiro span de uma requisição.
- **Criar o `FastifyOtelInstrumentation` depois do import da app** (o construtor instala o hook do
  `require-in-the-middle`): medido, sem diferença fora do ruído.
- **Desligar o `/healthz` de produção e ficar só com a landing:** a landing não passa pela
  Function, então uma Function quebrada só apareceria com tráfego real.

## Fontes (Context7)

- `/websites/vercel` (Fluid compute: Active CPU, cold starts, bytecode caching; pausa do Hobby e o
  `503 DEPLOYMENT_PAUSED` da deployment inteira), consultado em 2026-11-25.
- `/grafana/synthetic-monitoring-app` (checks HTTP: frequência e timeout), consultado em
  2026-11-25; o teto de 1 h já estava na validação do `grafana-as-code.ts`.
- `/sverweij/dependency-cruiser` (condição `dynamic` nas regras `forbidden`), consultado em
  2026-11-25.
- `/fastify/fastify/v5.12.7` (`schemaController.compilersFactory`: a fábrica devolve o compiler
  `({ schema, method, url, httpPart }) => validate`, o mesmo contrato do `setValidatorCompiler`),
  consultado em 2026-11-25; conferido no código instalado (Fastify 5.12.8). O `@fastify/otel`
  0.21.4 e o `@opentelemetry/instrumentation` 0.223.1 foram lidos no código instalado.
