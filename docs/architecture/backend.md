# Backend (`apps/api`)

Fastify 5 em Node 24, hexagonal, publicado como uma única Vercel Function (Fluid compute, `gru1`)
no mesmo projeto que serve o estático da web (ADR 0029). O mesmo `server.ts` roda no Plano B
(Render), na stack de CI, no Docker local e no `pnpm dev`.

## Stack

As versões vêm do catálogo do `pnpm-workspace.yaml`. Escolhas que fazem parte da decisão:

- `@fastify/type-provider-zod` + zod 4; `@fastify/swagger` + Scalar (`/api/docs`, só staging e CI);
  `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/under-pressure`. Sem `@fastify/cors`: tudo é
  mesma origem.
- Drizzle 1.0 RC (com `halfvec` nativo) e `pg` (exceção de proveniência, ADR 0002).
- Better Auth + `@better-auth/drizzle-adapter` (entry `/relations-v2`) + `@better-auth/passkey`,
  todos na mesma linha.
- `@google/genai` e `groq-sdk` só em `adapters/out/llm/**`.
- OTel 2.x com `@fastify/otel` e `@langfuse/otel` (veja [observabilidade](observabilidade.md)).
- `@vercel/functions` fixado em 3.7.6 (última com proveniência, ADR 0002), só em
  `adapters/out/platform/vercel`: `waitUntil`, `attachDatabasePool`, `ipAddress` e `geolocation`.
  Não exporta `getDeadline`: o prazo é `início + FUNCTION_MAX_DURATION_S` (porta
  `InvocationDeadline`), e a duração vem de uma única fonte, a mesma do `.vc-config.json`.
- tsdown empacota a API e a CLI (`dist/cli.mjs`); o `.vercel/output` é montado por
  `scripts/build-vercel-output.ts` (ADR 0017).

## Domínio, casos de uso e portas

**Domínio** (puro: depende só de zod e `@teko/shared`): `ReferenceDate` (data, `source`,
`periodBoundaryInside`), `ValidityInterval` (`[from, to)`, `to=null` para vigente), `Provision`
(`stableKey` imutável, separado de `displayLabel`), `ProvisionVersion`, `Chunk`, `Citation`,
`Answer` e `Refusal` (`out_of_coverage | no_evidence | model_insufficient | citation_invalid`).

**`stableKey`.** Usa `:` e leva a jurisdição como prefixo (`go:rcte:art:76:par:6:inc:II`,
`br:efd-icms-ipi:reg:C170:campo:07`, `br:<família>:nt:<ano-nnn>:item:<tópico>`), gerado e validado
em `domain/corpus/provision-id.ts`.

**Casos de uso:** `ResolveReferenceDate`, `CheckCoverage`, `AskQuestion`, `StreamAnswer`,
`HybridSearch`, `SearchProvisions`, `GetProvisionTimeline`, `GetProvisionDiff`, `RecordFeedback`,
`GetQuestion`, `ListHistory`, `CompleteOnboarding`, `ExportMyData`, `DeleteMyData`,
`PurgeExpiredData`. A ingestão usa `IngestDocumentVersion`, `EmbedPending`, `RefreshCoverage` e os
de snapshot e watch ([ingestão](ingestao-e-avaliacao.md)); o `seed-fixtures` passa pelo mesmo
`IngestDocumentVersion` do staging, sem caminho de escrita paralelo.

**Serviços:** `QuotaGuard`, `AnswerCacheService`, `PiiRedactor` (CPF e CNPJ com DV, e-mail,
telefone BR, chave NF-e; regex de `@teko/shared/pii`), `CitationValidator`, `ProviderRouter`
(cadeia com circuit breakers), `TraceSampler`.

**Portas:** `LLMPort.stream(prompt, {signal})`, `EmbeddingPort`, `RerankerPort`, repositórios
(`SearchRepository`, `CorpusRepository`, `CoverageRepository`, `QuestionRepository`),
`QuotaStore`, `RateLimitStore`, `AnswerCache`, `Clock`, `GeoResolver` (sobre `geolocation()` na
Vercel), `ClientIp` (sobre `x-real-ip` na Vercel), `Telemetry`, `UnitOfWork`, `ErrorReporterPort`,
`BackgroundTasks` (`waitUntil` na Vercel; nas outras plataformas só acompanha a promise),
`AnalyticsErasurePort` e `TraceErasurePort` (usadas por `DeleteMyData`), `BlobStore` (só CLI).

**Injeção.** Fiação manual e tipada em `composition-root.ts` (`createContainer(env)` →
`{useCases, close}`), exposta por `app.decorate('container')`. O container HTTP só monta o que a
API usa; escrita do corpus fica no container da CLI.

## Entrypoints

- `build-app.ts`: `buildApp(container)`, que nunca chama `listen`.
- `server.ts`: único entrypoint HTTP. Inicializa a telemetria, valida o env, **importa
  dinamicamente** `build-app` e `composition-root` (para a instrumentação registrar antes dos
  módulos instrumentados), monta o container e chama `listen({host:'0.0.0.0', port})`. Registra o
  handler de SIGTERM.
- `cli.ts`: subcomandos `ingest`, `sources-watch`, `seed-fixtures`, `eval-fixture`, `coverage-mark`
  e `maintenance`. Roda só no Actions e localmente, nunca na Vercel (AUP).
- `config/platform.ts` lê `RUNTIME_TARGET` (`vercel | render | node`) e escolhe `BackgroundTasks`,
  `attachDatabasePool` (só Vercel), `trustProxy`, `ClientIp` e `GeoResolver`.

**Asserções de boot** (`config/env.ts`, Zod, falha imediata):

- com `APP_ENV ∈ {staging, production}`: proibidos `LLM_PROVIDER=fake`, `EMBEDDINGS_PROVIDER=fake`
  e as rotas de eval (`/api/v1/_eval/*`, registradas só com `APP_ENV=ci`);
- `APP_ENV=development` com `NODE_ENV=production` é proibido;
- hosts exatos dos provedores (`generativelanguage.googleapis.com`, `api.groq.com`,
  `api.cloudflare.com`); qualquer `*_BASE_URL`/`*_API_BASE` de provedor derruba o boot, e a
  asserção é feita sobre o `baseURL` efetivo do cliente;
- com `RUNTIME_TARGET=vercel` em staging e produção: `process.version` `v24.*` e `VERCEL_REGION`
  `gru1` em runtime.

## Pipeline HTTP

1. Fastify com pino (`redact` de `authorization`, `cookie`, `set-cookie`, `*.question`),
   `bodyLimit` de 32 KB, `genReqId` pelo `x-vercel-id` na Vercel (senão um UUID) e `trustProxy`
   por plataforma: na Vercel, 1 salto (a Vercel sobrescreve `x-forwarded-for` e `x-real-ip`); no
   Render, o valor medido no ensaio; local e CI, só a rede da stack.
2. Compilers Zod e `@fastify/otel`.
3. `under-pressure` (`maxEventLoopDelay: 1000`) fora da Vercel; na Vercel fica desligado, porque o
   congelamento da instância entre invocações entra na medida (ADR 0017).
4. `helmet` com CSP `default-src 'none'` nas respostas da API (o CSP das páginas vem do build do
   estático, veja [frontend](frontend.md)).
5. Hook em `/api/*`: `Cache-Control: private, no-store`, `Vary: Cookie`, sem ETag. A CDN da Vercel
   nunca guarda resposta por usuário.
6. Rate limit da aplicação: `@fastify/rate-limit` com store em Postgres (`app.rate_limits`, janela
   fixa de 60 s com `INSERT … ON CONFLICT DO UPDATE … RETURNING count`), chave `user_id` com
   sessão ou IP (`x-real-ip`) sem sessão. Vale só nas rotas que já abrem transação e que nenhum
   outro controle cobre (`/api/v1/provisions*`, histórico e `/me/export`): `POST /questions` tem
   o `QuotaGuard`, `/api/auth/*` tem o rate limit do Better Auth e o stream tem a regra do WAF.
   `/healthz` e `/api/v1/coverage` (cache em memória) ficam fora, para não acordar o Neon.
7. Better Auth.
8. Swagger + Scalar em `/api/docs`, só no staging e no CI.
9. Rotas `/api/v1`.
10. Error handler RFC 9457 (`application/problem+json` com `code` e `traceId`). Recusa não é erro
    HTTP.

**CSRF.** Mutações e o stream exigem `Origin` igual ao domínio do ambiente
(`https://tekoia.vercel.app` ou `https://tekoia-staging.vercel.app`; localmente, a origem do
`pnpm dev`) e `content-type: application/json`. Cookies `SameSite=Lax`, `HttpOnly`, `__Secure-`.

## Superfície HTTP

Contrato canônico em `packages/shared/src/contracts` e no OpenAPI. Tudo na mesma origem.

| Rota                                                                                   | Observação                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` e `GET /api/healthz`                                                    | `{status, version, gitSha, env}`; nunca toca o DB. Fora da Vercel, 503 em drenagem                                    |
| `ALL /api/auth/*`                                                                      | Better Auth                                                                                                           |
| `POST /api/v1/me/onboarding`                                                           | 18+, aceite dos termos (com versão), país de residência                                                               |
| `GET /api/v1/me`, `GET /api/v1/me/quota`, `GET /api/v1/me/export`, `DELETE /api/v1/me` | LGPD                                                                                                                  |
| `GET /api/v1/coverage`                                                                 | Público, cache em memória de até 10 min; é o smoke de DB                                                              |
| `POST /api/v1/questions`                                                               | `answered \| refused \| needs_clarification \| accepted{questionId, resolved}`; query string → 400 `validation_error` |
| `POST /api/v1/questions/:id/stream`                                                    | Cookie de sessão + `Origin`; UI Message Stream v1; um stream por pergunta (claim atômico)                             |
| `GET /api/v1/questions`, `GET /api/v1/questions/:id`                                   | Histórico por `conversationId`                                                                                        |
| `POST /api/v1/questions/:id/feedback`                                                  | Polegar e motivo, inclusive "citação errada"                                                                          |
| `GET /api/v1/provisions?q=&family=&at=`, `…/:stableKey/timeline`, `…/:stableKey/diff`  | Paleta, linha do tempo e diff (por campo nos registros)                                                               |
| `POST /api/v1/_eval/answer`, `GET /api/v1/_eval/search`                                | Só com `APP_ENV=ci`, em plugin separado; com `APP_ENV=staging` dão 404 (teste de integração)                          |

**Enums** (em `@teko/shared`): `ReferenceSource` (`explicit | periodo_apuracao | question_text |
default | clarified`), `RetrievalMode` (`hybrid | lexical_only`) e `ErrorCode`
(`validation_error`, `unauthenticated`, `forbidden` (ex.: `Origin` errado), `not_found`,
`onboarding_required`, `quota_exceeded` com `meta.scope: user_daily | global_daily`,
`rate_limited` com `Retry-After`, `service_paused`, `stream_busy`, `upstream_unavailable`,
`region_restricted`, `internal`).

**Variáveis que mudam comportamento:** `LLM_KILL_SWITCH=true` (cache hit responde; miss dá 503
`service_paused`), `GEMINI_MODEL_PRIMARY`, `GEMINI_MODEL_FALLBACK`, `GROQ_MODEL`, `LLM_PROVIDER`,
`EMBEDDINGS_PROVIDER`, `RERANKER_PROVIDER` (`workers-ai` em staging e produção).

## Autenticação (Better Auth)

```ts
betterAuth({
  baseURL: env.WEB_ORIGIN, basePath: '/api/auth', trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }), // '/relations-v2'
  socialProviders: { github: {...}, google: {...} },                   // OAuth apps por ambiente
  plugins: [passkey({ rpID: new URL(env.WEB_ORIGIN).hostname, rpName: 'Tekó', origin: env.WEB_ORIGIN })],
  session: { expiresIn: 604800, updateAge: 86400, cookieCache: { enabled: true, maxAge: 300 } },
  user: { additionalFields: { termsAcceptedAt, termsVersion, isAdult, countryOfResidence } },
  advanced: { useSecureCookies: true, cookiePrefix: env.APP_ENV === 'production' ? 'teko' : 'teko-stg',
              database: { generateId: 'uuid' }, ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
  rateLimit: { enabled: true, storage: 'database' },                   // várias instâncias Fluid
})
```

- **`advanced.database.generateId: 'uuid'` é obrigatório:** as FKs `user_id` do schema `app` são
  `uuid`, e o padrão do Better Auth gera IDs em texto.
- **`cookieCache` de 300 s.** Reduz leituras de sessão no Neon, mas uma sessão revogada (logout em
  outro dispositivo, `DELETE /me`) continua válida por até 5 min no cookie. O desenho do DSR
  considera isso: `DELETE /me` e `GET /me/export` leem a sessão do banco (sem o cache), e a janela
  de 5 min fica registrada no `ropa.md`.
- O `rpID` é o hostname do ambiente (`tekoia.vercel.app`); os domínios antigos
  `teko-api*.vercel.app` respondem 308 para o canônico, porque cookie e passkey dependem de um host
  único.
- Primeiro login por OAuth; a passkey é registrada depois, com sessão ativa. Callbacks em
  `https://tekoia.vercel.app/api/auth/callback/{github,google}` e no equivalente de staging. Sem
  `oAuthProxy` nem previews.
- O schema `auth.*` é gerado pelo CLI do Better Auth; um teste de integração cobre sign-in e sessão
  com o adapter `relations-v2`.

## Modelo de dados

Drizzle 1.0, schemas `corpus`, `app` e `auth`, IDs `uuidv7()`, casing por tabela. As tabelas de
`corpus` estão em [ingestão](ingestao-e-avaliacao.md#modelo-do-corpus). As de aplicação:

| Tabela                                                | Colunas-chave                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.questions`                                       | `user_id`, `conversation_id`, `question_redacted`, `locale`, `families`, `reference_date`, `reference_source`, `status` (`pending/streaming/answered/refused/failed/aborted/expired`), `refusal_reason`, `answer_md`, `citations`, `retrieval`, `retrieval_mode`, `provider`, `model`, `prompt_version`, `corpus_version`, `cache_key`, tokens, `shadow_cost_usd`, `ttft_ms`, `latency_ms`, `langfuse_trace_id`, `stream_started_at` |
| `app.feedback`, `app.answer_cache`, `app.usage_daily` | `usage_daily` (PK `day, scope`): `requests`, tokens, `neurons`, `langfuse_units`, `stream_seconds`                                                                                                                                                                                                                                                                                                                                   |
| `app.rate_limits`                                     | PK `(key, window_start)`, `count`, `expires_at`; janelas vencidas apagadas pela manutenção semanal                                                                                                                                                                                                                                                                                                                                   |

**Roles.** `teko_app` (runtime e manutenção: DML em `app`/`auth`, SELECT em `corpus`,
`statement_timeout` e `idle_in_transaction_session_timeout` de 5 s no role) e `teko_watch` (só
`verified_at`, `gaps` e `gap_reason` de `corpus.coverage`). São criados fora das migrações, com
`scripts/neon-roles.ts` ([runbook](../runbooks/neon-roles.md)); a migração só configura e concede,
de forma idempotente. A ingestão e o `promote` usam a URL do owner.

**Migrações.** `drizzle-kit generate` em dev; aplicadas no deploy com `drizzle-kit migrate` na URL
direta (o staging também pelo `ingest load --migrate`). Sempre expand/contract: o
`migration-guard` bloqueia `DROP`/`RENAME` sem o label `contract` e `CREATE INDEX CONCURRENTLY`.

## Busca, data de referência e cobertura

- **Busca híbrida** (ADRs 0010 e 0027): uma instrução SQL com braços léxico (FTS em dois
  estágios), semântico (HNSW `halfvec`) e por chave exata, fundidos por RRF k = 60, filtrados por
  vigência (`valid_during @> $data`), `upper_inf(knowledge)`, família e `review_status` (produção:
  `auto, approved`; staging: + `pending`). Um resultado por versão de dispositivo. Com
  `RERANKER_PROVIDER=workers-ai`, 40 candidatos são reordenados e 12 devolvidos; falha ou mais de
  3 s mantêm a ordem do RRF. O SQL vigente é o de
  `adapters/out/persistence/drizzle/sql/hybrid-search.ts`; os `SET LOCAL` do HNSW vão num único
  `SELECT set_config(…, true)` dentro da transação curta, sem prepared statements nomeados
  (PgBouncer em modo transação), e datas voltam como texto (`::text`), sem conversão por fuso.
- **Citação:** prefere a versão de documento publicada cuja vigência contém a data; senão, o
  snapshot publicado mais recente que contém o chunk. Em consolidados (RCTE, CTE), a vigência
  citada vem sempre do chunk.
- **`ResolveReferenceDate`:** precedência escolha explícita → data única do texto → `default`
  (mês anterior). O PA `AAAA-MM` resolve para o dia 1; `periodBoundaryInside=true` quando alguma
  evidência tem vigência que começa ou termina dentro do mês ou, se nenhuma tem, quando alguma
  redação da unidade de topo das evidências e das chaves citadas (artigo, registro, evento,
  tabela) cruza o mês com fronteira dentro dele (`valid_during && daterange(PA)`, consulta só
  nesse caso), e a UI avisa. Conflito entre texto e escolha explícita, ou
  datas conflitantes no texto, dão `needs_clarification`. "Hoje" em `America/Sao_Paulo`.
- **`CheckCoverage`:** cobertura efetiva = `covered * datemultirange(daterange(NULL,
  verified_at + 1))` menos `gaps` (ADR 0009). Data fora → `refused/out_of_coverage` sem LLM;
  cobertura parcial segue só nas famílias cobertas (`data-meta.uncoveredFamilies`). Cache em
  memória de 10 min por instância, invalidado quando a `corpus_version` muda.
- **Recusas sem LLM:** retrieval vazio ou `max(rrf) < MIN_EVIDENCE_RRF`. **Depois do LLM:**
  sentinel `INSUFICIENTE` ou zero citação válida.

## Pergunta e streaming

1. **`POST /api/v1/questions`** (transações curtas): sessão, onboarding, política regional e kill
   switch; `pg_advisory_xact_lock` por usuário, para que duas abas não passem juntas pelo
   `QuotaGuard`; `QuotaGuard` (teto global e por usuário em `usage_daily`, 1 stream ativo por
   usuário: `streaming` com `stream_started_at > now() − 110 s`); **reserva de `stream_seconds`**
   (o teto do stream, 100 s) antes de aceitar, devolvida no fim pelo uso real; redação, data e
   cobertura; cache exato (`sha256(normalize(q)|refDate|corpus_version|PROMPT_VERSION|modelFamily|locale)`);
   num miss, `INSERT questions(status='pending')` e `accepted{questionId}`.
2. **Stream** (`POST /api/v1/questions/:id/stream`, mesma origem, cookie + `Origin`): claim
   atômico `UPDATE app.questions SET status='streaming', stream_started_at=now() WHERE id=$1 AND
   user_id=$2 AND status='pending' RETURNING …`; zero linhas → 409 `stream_busy`. Headers
   (`text/event-stream`, `no-cache, no-transform`, `x-vercel-ai-ui-message-stream: v1`,
   `x-trace-id`) antes de qualquer I/O, heartbeat `: hb` a cada 15 s, `reply.send(Readable.from(…))`.
   Sequência: `start`, `data-reference-date`, `data-meta`, `data-citation` (S1…Sn), `text-*`,
   `data-refusal`, `finish` (ou `error` com `{code, retryable}`); o `CitationValidator` marca no
   fim as citações inválidas (`valid:false`). Um teste de contrato valida cada chunk contra o
   `uiMessageChunkSchema` do pacote `ai`.
3. **Pipeline:** embedding com teto de 3 s (falha → `lexical_only` rotulado); busca em transação
   curta, com a conexão devolvida **antes** do LLM; LLM com `AbortSignal.any([request.signal,
   deadline])` e teto de 90 s; stream com teto próprio de `min(100 s, prazo − agora − 20 s)`
   (o `handlerTimeout` do Fastify não corta um stream já iniciado). Timeout → `error`
   `upstream_unavailable` retryable.
4. **Finalização:** uma transação curta grava `questions` (com `shadow_cost_usd`), `usage_daily`
   (acerta a reserva de `stream_seconds` pelo uso real) e `answer_cache` antes do `finish`. Flushes
   de telemetria em `BackgroundTasks` (`waitUntil`), cada um com teto de 500 ms.
5. **Desconexão:** `request.signal` aborta o LLM em menos de 1 s (na Vercel, graças ao
   `supportsCancellation`, padrão no `.vc-config.json`); `aborted` é gravado por `BackgroundTasks`.
   A cota consumida não volta. Sem resume: o cliente relê `GET /questions/:id`.
6. **Deploy e SIGTERM:** deployments são imutáveis; o `promote` só desvia requisições novas. No
   scale-down, SIGTERM com 500 ms: `forceFlush` ≤ 400 ms e `pool.end()`. Fora da Vercel, drenagem:
   `/healthz` 503, perguntas novas 503 e streams ativos terminam.

## LLM, PII, prompt e tetos

- **Cadeia:** `gemini-3.6-flash` → `gemini-3.5-flash-lite` → `openai/gpt-oss-120b` (Groq, ZDR), IDs
  por env. Fallback só antes do primeiro token. Breaker por modelo: 429 abre até o `retry-after` ou
  a meia-noite do Pacífico; 3 falhas de 5xx/timeout abrem por 60 s.
- **Política regional:** EEE/UK/CH só no Groq. Origem: país declarado no onboarding **ou**
  `geolocation()` da Vercel (header de país da plataforma; sem base GeoIP no repositório). Fora da
  Vercel, só o país declarado.
- **Prompt:** `application/prompts/answer.md` com `version`; `PROMPT_VERSION = name@semver+sha8`;
  `pricing.json` versionado alimenta o custo-sombra. Fontes em `<source id="S1" …>` com escape e
  sem caracteres de controle; o prompt diz que fontes são dados. Sem tools nem grounding. Canary no
  system prompt bloqueia a saída se vazar. Pergunta ≤ 1.000 caracteres, temperatura 0,1, saída ≤
  1.200 tokens.
- **Tetos por ambiente** (env, contadores em `usage_daily`):

| Ambiente | Perguntas/dia | Por usuário | Neurons/dia | Segundos de stream/dia |
| -------- | ------------- | ----------- | ----------- | ---------------------- |
| prod     | 300           | 30          | 800         | 6.000                  |
| staging  | 50            | 50          | 200         | 1.500                  |

Esgotado o `stream_seconds`, perguntas que exigiriam stream recebem `quota_exceeded`
(`global_daily`); cache hits continuam respondendo.

## Vercel

| Projeto          | Ambiente   | Domínio canônico                    | Domínio antigo (308)                  | Neon           |
| ---------------- | ---------- | ----------------------------------- | ------------------------------------- | -------------- |
| `tekoia`         | production | `https://tekoia.vercel.app`         | `https://teko-api.vercel.app`         | `teko-prod`    |
| `tekoia-staging` | staging    | `https://tekoia-staging.vercel.app` | `https://teko-api-staging.vercel.app` | `teko-staging` |

- Time Hobby pessoal, Fluid compute, Functions em `gru1`, **sem repositório Git conectado**: o
  deploy só acontece pela CLI, no Actions (ADRs 0004 e 0017). Staging é um projeto à parte, não um
  Preview; cada projeto só recebe deploys `--prod`.
- **Build Output** (`scripts/build-vercel-output.ts`): o `apps/web/out` vai para
  `.vercel/output/static`; o `config.json` traz, nesta ordem, os 308 dos domínios antigos
  (`has: host`), os headers por caminho (CSP e demais, `/_next/static/*` imutável), o redirect de
  `/` para `/pt-BR/` ou `/en/` por `Accept-Language`, `handle: filesystem`, `/api/*` e `/healthz`
  para a Function `index`, e o 404 por locale. As rotas são escritas à mão (o
  `@vercel/routing-utils` não tem proveniência, ADR 0002).
- A Function `index` declara `maxDuration` e `supportsCancellation: true` no `.vc-config.json`;
  `apps/api/vercel.json` fixa `regions: ["gru1"]`, `fluid: true` e `git.deploymentEnabled: false`.
  Sem crons da Vercel: todo agendamento fica no Actions.
- **Postura não comercial e AUP:** gratuito e MIT, sem anúncios, afiliados, patrocínio exibido ou
  serviço pago ligado ao deploy (doações permitidas). A Function só responde sobre dados já
  ingeridos; raspagem, ingestão e embeddings em lote rodam no Actions.
- **Configuração do time** (checklist em `infra/vercel/README.md`, reconferido todo mês): opt-out
  de Model Training, 2FA, Deployment Protection Standard (domínios de produção públicos; URLs
  únicas e deployments antigos exigem login na Vercel), AI Gateway, marketplace e Cron desligados.

**Limites do Hobby que o código respeita**

| Limite                      | Valor                                     | Consequência                               |
| --------------------------- | ----------------------------------------- | ------------------------------------------ |
| Memória e CPU por instância | 2 GB / 1 vCPU                             | a stack de CI usa os mesmos limites        |
| Duração máxima              | 300 s, incluindo o stream                 | teto de 100 s no stream; heartbeat de 15 s |
| Payload                     | 4,5 MB (request e resposta não streamada) | `bodyLimit` de 32 KB                       |
| File descriptors            | 1.024 por instância                       | pool `pg` com `max: 3`                     |
| SIGTERM no scale-down       | 500 ms                                    | `forceFlush` ≤ 400 ms e `pool.end()`       |
| Logs de runtime             | 1 h, sem drains                           | logs duráveis via OTLP                     |
| Deploys                     | 100/dia                                   | um por push em `main` e um por release     |

**WAF** (Hobby: 3 regras custom, 1 delas de rate limit; regras em
`infra/vercel/firewall-rules.json`, aplicadas pela API de firewall):

1. **Deny** em `/api/*` fora dos prefixos conhecidos (`/api/healthz`, `/api/auth/*`, `/api/v1/*` e,
   só no staging, `/api/docs*`). O estático e `/healthz` passam.
2. **Deny** em métodos diferentes de GET e HEAD fora de `/api/*` e `/healthz`: o estático só é
   lido (no lugar da regra do `x-nf-sign`, que saiu com a Netlify).
3. **Rate limit** em `POST /api/v1/questions/*/stream`, por IP, 10 requests em 60 s → 429.

Nenhuma regra usa Challenge. Tráfego negado pelo WAF não invoca a Function e não conta CDN
Requests nem Fast Data Transfer (veja [contas e cotas](contas-e-cotas.md)).

**Pool.** `pg` Pool no host `-pooler` do Neon com `attachDatabasePool`:
`{max: 3, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 8_000}`. Retry único, fora de
transação, em erro de conexão transitório (`57P01`, `ECONNRESET`), para reconectar depois do
scale-to-zero.

**Segredos e configuração.** Segredos de runtime são env vars **Sensitive** do ambiente Production
de cada projeto (`DATABASE_URL` do `teko_app`, chaves de Gemini, Groq e Workers AI, Better Auth e
OAuth apps, Langfuse de runtime, OTLP do Grafana, chave pessoal do PostHog para erasure). Nunca
existem no GitHub nem no build. A configuração não secreta (`APP_ENV`, `RUNTIME_TARGET`,
`WEB_ORIGIN`, modelos, tetos, amostragens, `RERANKER_PROVIDER`) fica em
`infra/vercel/env.{staging,production}.json`, aplicada antes de cada deploy por um script de sync
que falha se faltar uma Sensitive. Env var só vale em deployment nova: rotação = atualizar a
Sensitive + redeploy.

**Manutenção semanal** (`weekly-maintenance` do `ops.yml`, domingo 06:00 UTC, environment
`maintenance`, role `teko_app`): `PurgeExpiredData` (conversas > 90 dias, `pending` > 1 dia →
`expired`, cache e janelas de rate limit vencidos). Acorda cada Neon uma vez por semana.

## Regras de CU-h no Neon

1. `/healthz`, monitores e o WAF nunca tocam o DB.
2. Nenhum cron toca o DB, exceto a manutenção semanal, o `mark-coverage` diário do `source-watch` e
   o rehearsal de release.
3. Pool com `attachDatabasePool` e os timeouts no role; o resto com `SET LOCAL`.
4. Retry único em erro de conexão transitório, fora de transação.
5. Cobertura e `corpus_version` em memória por instância, relidas no máximo a cada 10 min.
6. Autoscaling 0,25 CU (ou 0,25–0,5), scale-to-zero em 5 min.
7. Consumo medido pelo `ops.yml`; Neon suspenso → runbook `neon-suspended.md` (a escrever na F6).

## Plano B (Render Free)

- **Quando:** pausa de 30 dias do Hobby, conta Vercel encerrada ou termos que inviabilizem o
  projeto.
- **Serviço:** um web service Node do Render Free (`teko-api-planb`, Virginia), descrito em
  `infra/planb-render/render.yaml`, com auto-deploy desligado. **O mesmo serviço serve o `out/`
  estático e a API, na mesma origem**, com o mesmo `server.ts` (`RUNTIME_TARGET=render`); as rotas
  do Build Output (redirect por idioma, headers, 404 por locale) são reproduzidas no servidor.
- **Diferenças:** sem WAF, o rate limit do stream passa ao `@fastify/rate-limit` em Postgres (10
  req/60 s por IP do `ClientIp` medido no ensaio); política regional só pelo país declarado.
- **Corte:** os usuários passam a usar o host do Render (`WEB_ORIGIN` = host do Render, OAuth
  callbacks e `rpID` do passkey acompanham, então passkeys precisam ser registradas de novo). Só a
  produção tem Plano B. Sem forma de pagamento, o Render suspende em vez de cobrar.
- **Proveniência:** o Render constrói a partir da tag do release; exceção aceita só durante o
  corte.
- **Ensaio:** a cada release minor, registrado no runbook `vercel-paused.md` (a escrever na F7).
