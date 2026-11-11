---

status: proposed
date: 2026-11-10
decision-makers: Rafael Daily Santos Martins
---

# 0003 — Resultados dos spikes da F1

## Contexto e problema

O plano depende de comportamentos de plataformas que a documentação não garante por completo:
zero-config do Fastify na Vercel num monorepo pnpm, contexto de deploy no proxy assinado da
Netlify, cancelamento e prazo de invocação em Fluid compute, reconexão do Neon após
scale-to-zero, exports do pacote `ai` e qualidade do Docling. A F1 só termina quando cada spike
tiver resultado registrado aqui e as decisões dependentes estiverem ajustadas no plano e nas ADRs.

Os spikes seguem o plano revisado em 2026-11-10, em que a API saiu da VM Oracle e foi para o
Vercel Hobby ([ADR 0004](0004-vercel-hobby-api.md)). Os spikes de VM, cloud-init, imagem arm64 no
GHCR e deployer blue/green deixaram de existir.

## Spikes

| Spike | Pergunta                                                                                                                                                                                                                     | Status                                                                                                        | Resultado                                                                                                                                  | Decisão decorrente                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)   | Build do Next no Actions + `netlify deploy --build --context develop --alias develop` com `NETLIFY_NEXT_PLUGIN_SKIP`: o deploy tem 0 functions e o env por contexto é aplicado?                                              | pendente — requer tokens (contas criadas em 2026-11-10)                                                       | Há um export estático local em `apps/web/out` e o `ci.yml` falha se aparecer `.netlify/functions`; o deploy real depende do PAT da Netlify |                                                                                                                                                                                                         |
| (b)   | Fastify "hello" com o `server.ts` real no `teko-api-staging`, pelo fluxo do CI (build → tarball atestado → `vercel deploy --prebuilt --prod --skip-domain` → `vercel curl` → `vercel promote`). Ver "Checklist do spike (b)" | deploy e `/healthz` concluídos (2026-11-11); verificações manuais pendentes                                   | O zero-config quebra no boot; o Build Output API montado do bundle do tsdown funciona, em `gru1` e Node 24 (ver "Spike (b)")               | Build Output API pelo tsdown ([ADR 0017](0017-vercel-build-output-tsdown.md)); `under-pressure` sem limite de atraso do event loop na Vercel; `maxDuration`/`supportsCancellation` no `.vc-config.json` |
| (c)   | Plugin `context-routing` contra uma rota de echo no `teko-api-staging.vercel.app`. Ver "Checklist do spike (c)"                                                                                                              | pendente — requer tokens (contas criadas em 2026-11-10)                                                       |                                                                                                                                            | Allowlist de `deploy_context`; header de IP do cliente                                                                                                                                                  |
| (d)   | Neon `-pooler` com timeouts por role (o pooler não aceita `statement_timeout` como parâmetro de conexão), `attachDatabasePool` e reconexão após scale-to-zero                                                                | pendente — requer tokens (contas criadas em 2026-11-10)                                                       |                                                                                                                                            | Timeouts no role; retry único em `57P01`/`ECONNRESET`                                                                                                                                                   |
| (e)   | Exports `parseJsonEventStream` e `uiMessageChunkSchema` do pacote `ai`                                                                                                                                                       | concluído                                                                                                     | Os dois são exportados pelo entry `ai` (ver "Spike (e)")                                                                                   | O `TicketedChatTransport` pode importar os dois de `ai`; a versão do catálogo precisa respeitar os 7 dias                                                                                               |
| (f)   | Ingestão: Docling ACCURATE contra V2 no Guia 3.2.4, formato do WS de Tabelas Externas, `bge-m3` com dimensão 1024 e plugins locais do promptfoo                                                                              | pendente — requer tokens (contas criadas em 2026-11-10) para `bge-m3`; Docling real e WS ainda não executados | `tools/ingest` existe com testes sobre dublês do Docling (55 testes, cobertura de 100%); nenhuma conversão real foi feita                  |                                                                                                                                                                                                         |
| (g)   | Conferência via Context7 de todas as versões da tabela "Ferramentas da raiz" (inclusive a Vercel CLI) e das tabelas de stack de API (inclusive `@vercel/functions`) e web                                                    | parcial                                                                                                       | Ver "Spike (g)"                                                                                                                            | Versões seguradas e exceções na [ADR 0002](0002-supply-chain-pnpm.md)                                                                                                                                   |

### Checklist do spike (b)

- O zero-config detecta `src/server.ts` no monorepo pnpm (Root Directory `apps/api`) e resolve
  `@teko/shared` em `.ts` e os subpath imports; senão, adotar o fallback do Build Output API
  gerado pelo tsdown.
- `engines.node: "24.x"`, `VERCEL_REGION=gru1` em runtime e o nome da Function gerada.
- SSE de 95 s pelo domínio de produção, com heartbeat de 15 s e primeiro byte atrasado em 30 s,
  sem corte nem buffering.
- Detecção de desconexão (`request.signal` e `close` do `request.raw`) com e sem
  `supportsCancellation`, e cancelamento do fetch upstream.
- `waitUntil` depois da resposta e o handler de SIGTERM. O `@vercel/functions` 3.7.6 do catálogo
  não exporta `getDeadline` (ver ADR 0002): o spike confere o prazo calculado a partir do
  `maxDuration` configurado.
- Deploy e `promote` durante um stream ativo: o stream termina na deployment antiga.
- Uma Sensitive de teste visível em runtime e ausente do `.vercel/output` e do tarball.
- `vercel curl` na URL única protegida, URL única sem bypass bloqueada e domínio de produção
  público.
- `vercel rollback` e `vercel promote` de uma deployment de produção mais antiga no Hobby.
- Tempo de cold start (p95) e `attachDatabasePool` com o Neon.

### Checklist do spike (c)

- Claims do `x-nf-sign`: `deploy_context` real num alias publicado via CLI e qual valor do
  segredo assina.
- Passagem de `Cookie`/`Set-Cookie`.
- Presença de `x-nf-client-connection-ip` e se a Netlify sobrescreve um valor enviado pelo
  cliente; o que a Vercel entrega em `x-real-ip` e `x-forwarded-for` (IPs de saída da Netlify).
- Ausência de cache CDN na Netlify e na Vercel.
- Regra 2 do WAF sem bloquear o proxy; Deployment Protection Standard sem bloquear o domínio de
  produção.
- Latência extra Netlify → `gru1` e o pior caso de cold start + resume do Neon dentro do corte de
  26 s do proxy.

## Spike (b): API na Vercel

Executado em 2026-11-11 pelo `spike-api-vercel.yml` no environment `staging` (Vercel CLI 65.11.0).

| Execução                                          | O que mostrou                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run 42980171686 (zero-config)                     | `vercel pull`, `vercel build --prod`, tarball atestado e `vercel deploy --prebuilt` funcionam, e o `vercel build` reaproveita a instalação do CI ("Done in 2ms using pnpm v12.18.0"). Mas o builder `@vercel/fastify` 24.0.1 compila `src/server.ts` para `server.js` mantendo os imports `.ts`, e a Function cai com `ERR_MODULE_NOT_FOUND: /var/task/apps/api/src/composition-root.ts` (HTTP 500 `FUNCTION_INVOCATION_FAILED`) |
| Run 42987608534 (Build Output API, ADR 0017)      | Deployment `teko-api-staging-280foje06`; `vercel inspect`: `λ index (8.54MB) [gru1]`. `/healthz` e `/api/healthz` com 200 e `{"env":"staging"}` na URL única (via `vercel curl` com o bypass), `x-vercel-id: pdx1::gru1::…`. URL única sem bypass: HTTP 302 (login da Vercel). Promote ok, e o domínio de produção respondeu 200 sem bypass no passo de promote                                                                  |
| Depois do run 42987608534                         | `https://teko-api-staging.vercel.app/healthz` alterna para 503 `service_paused` depois de ~10 s de ociosidade (sequência medida: `0s→503, 3s→200, 10s→503, 0s→503, 30s→503`). Causa: o `under-pressure` (`maxEventLoopDelay: 1000`) lê o congelamento da instância Fluid entre invocações como atraso do event loop. Corrigido no rafaeldailymartins/teko#8 (limite desligado só na Vercel)                                      |
| Run 42989881707 (com o rafaeldailymartins/teko#8) | Deployment `teko-api-staging-l3y0d2e7b`, `λ index (8.55MB) [gru1]`, smoke e promote verdes. No domínio de produção, sem bypass, 13 de 13 respostas 200 com intervalos de 0, 3, 10, 30 e 60 s entre elas, e `X-Vercel-Id: gru1::gru1::…`                                                                                                                                                                                          |

Conclusões:

- **Node 24 e `gru1` efetivos.** Com `APP_ENV=staging` e `RUNTIME_TARGET=vercel`, as travas de
  boot (`apps/api/src/config/env.ts`) exigem `process.version` `v24.*` e `VERCEL_REGION=gru1`; o
  200 com `env: staging` prova os dois. O `vercel inspect` e o `x-vercel-id` (borda `pdx1`,
  Function `gru1`) confirmam a região. O `.vc-config.json` não declara região: ela vem do
  projeto.
- **Nome da Function: `index`** (`functions/index.func`, gerada por `scripts/build-vercel-output.ts`).
  Com output pronto, `maxDuration` e `supportsCancellation` vão no `.vc-config.json`, não no
  `functions` do `vercel.json`.
- **Deployment Protection Standard** como planejado: URL única exige login (302) e o domínio de
  produção é público.
- **Env vars.** O projeto não tinha nenhuma; as Config da F1 de `infra/vercel/env.staging.json`
  (`APP_ENV`, `NODE_ENV`, `RUNTIME_TARGET`, `WEB_ORIGIN`, `FUNCTION_MAX_DURATION_S`,
  `LOG_LEVEL`) foram gravadas à mão no spike, como Config de Production, com aval do mantenedor.
  O `scripts/vercel-env-sync.ts` da F7 assume isso. Sem `APP_VERSION`/`GIT_SHA`, o `/healthz`
  responde `version: 0.0.0` e `gitSha: unknown`.

Continuam abertos no checklist: SSE de 95 s, desconexão com e sem `supportsCancellation`,
`waitUntil` e SIGTERM, promote e deploy durante stream, `vercel rollback`, Sensitive de teste
ausente do output, cold start (p95) e `attachDatabasePool` (este com o spike (d)).

## Spike (e): exports do pacote `ai`

Conferido em 2026-11-10.

| Fonte                                      | Resultado                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm view ai@7.0.169 --json`               | `latest` = 7.0.169, publicada em 2026-11-10T20:18Z por OIDC do GitHub Actions, com `dist.attestations.provenance` (`https://slsa.dev/provenance/v1`). `exports` tem só `.`, `./test`, `./internal` e `./package.json` |
| `ai@7.0.169`, `dist/index.d.ts` (jsDelivr) | `export declare const uiMessageChunkSchema: LazySchema<UIMessageChunk<...>>`; `parseJsonEventStream` é importado de `@ai-sdk/provider-utils` e reexportado na lista final de exports                                  |
| `ai@7.0.169`, `dist/index.js` (jsDelivr)   | A lista final de exports contém `parseJsonEventStream` e `uiMessageChunkSchema`                                                                                                                                       |
| `ai@7.0.162`, `dist/index.js` (jsDelivr)   | Idem: os dois nomes estão na lista final de exports                                                                                                                                                                   |
| Context7 `/vercel/ai/ai_7.0.0`             | A documentação de transports manda seguir o `HttpChatTransport`/`DefaultChatTransport`, que fazem esse parse; não há página de referência para os dois símbolos (não são documentados como API pública estável)       |

Conclusão: os dois símbolos existem no entry principal `ai`, em runtime e nos tipos. Ressalvas:

- a 7.0.169 foi publicada no próprio dia 2026-11-10 e é recusada pelo `minimumReleaseAge` de 7
  dias. A versão mais nova elegível nessa data era a **7.0.162** (2026-11-03T01:19Z, com
  proveniência SLSA), que também exporta os dois nomes;
- como os símbolos não têm página de referência, o teste de contrato do stream
  (`packages/shared/src/contracts/stream.ts`) protege contra remoção numa atualização do
  Dependabot.

## Spike (g): conferências feitas

### Versões e maturidade (2026-11-10)

- **Catálogo como fonte da verdade.** Com o `minimumReleaseAge: 10080`, 13 pacotes foram recuados
  para a versão mais nova com pelo menos 7 dias: `next` 16.4.5, `@biomejs/biome` 2.6.4,
  `@fission-ai/openspec` 1.16.0, `knip` 6.44.1, `tsdown` 0.23.5, `jscpd` 5.4.2, `@fastify/cors`
  11.4.0, `@scalar/fastify-api-reference` 1.76.4, `tailwindcss` e `@tailwindcss/postcss` 4.3.4,
  `next-intl` 4.14.9, `steiger` 0.9.0 e `lefthook` 2.2.1 (este também por falta de proveniência
  na 2.2.2). Tabela completa e `type-coverage` 2.31.1 na ADR 0002.
- **Proveniência.** `next@16.4.5` tem `dist.attestations` SLSA v1. `lefthook@2.2.2` saiu sem
  proveniência (fixado em 2.2.1). `chokidar@4.0.3` (exigido pelo steiger) sem proveniência
  (`trustPolicyExclude` exato). `vercel@65.11.0` e todo `@vercel/*` publicado desde ago/2026: só
  trusted publisher, sem `dist.attestations` → CLI isolado em `tools/vercel-cli`;
  `@vercel/functions` fixado em 3.7.6 (sem `getDeadline`). O pacote `ai` (repositório
  `vercel/ai`) **continua** com proveniência (7.0.162 e 7.0.169 conferidas).
- **Python.** `tools/ingest` usa `exclude-newer = "7 days"` no `[tool.uv]` (cooldown equivalente
  aos 7 dias do pnpm, conferido no Context7 `/astral-sh/uv/0.13.5`).

### Conferências por biblioteca

| Item                                  | Fonte                                                           | Resultado                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@fission-ai/openspec`                | Context7 `/fission-ai/openspec` + CLI local 1.16.0              | `init --tools claude --language`, `config.yaml` (`schema`, `context`, `rules`) e `validate --strict` conferem com o plano; versão 1.16.0 (1.17.0 segurada pela regra de 7 dias)                                                            |
| pnpm 12 (settings de supply chain)    | Context7 `/pnpm/pnpm/v12.15.0`                                  | `trustPolicy`, `trustPolicyExclude`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds` e `catalogMode` existem com a semântica usada                                                                                                |
| Turborepo                             | Context7 `/vercel/turborepo/v2.11.10` (stream da raiz)          | Versão 2.11.10 conferida; configuração do `turbo.json` escrita a partir dessa documentação                                                                                                                                                 |
| Biome                                 | Context7 `/biomejs/biome` e `/biomejs/website` (stream da raiz) | Versão 2.6.4 no catálogo (2.6.6 segurada pela regra de 7 dias); `biome.json` escrito a partir dessa documentação                                                                                                                           |
| Vercel (plataforma e CLI)             | Context7 `/websites/vercel`                                     | Hobby: 300 s, 2 GB / 1 vCPU, uma região de Functions, 1.024 file descriptors; `vercel build` + `vercel deploy --prebuilt --prod`; `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`; `@vercel/functions` atual documenta `getDeadline`, ausente na 3.7.6 |
| Render (Plano B)                      | Context7 `/websites/render`                                     | 750 instance-hours por workspace, spin-down após 15 min, cerca de 1 min para voltar, suspensão sem forma de pagamento                                                                                                                      |
| uv                                    | Context7 `/astral-sh/uv/0.13.5`                                 | `exclude-newer` aceita duração relativa (`1 week`, `7 days`, `P7D`)                                                                                                                                                                        |
| `pgvector/pgvector:0.8.6-pg18-trixie` | `docker buildx imagetools inspect` + teste local                | Digest `sha256:78bf48b8…`; PostgreSQL 18.6, extensão `vector` 0.8.6, `PGDATA=/var/lib/postgresql/18/docker`                                                                                                                                |
| Caddy (só o proxy de dev local)       | Context7 `/websites/caddyserver_caddyfile` + imagem             | A tag atual é `2.11.9-alpine` (digest `sha256:0bbb055b…`); `header_up`, `request_body`, `response_header_timeout` e `{env.*}` conferidos. Em produção não há Caddy                                                                         |
| Langfuse self-hosted (só dev local)   | Context7 `/websites/langfuse_self-hosting` + teste local        | `langfuse`/`langfuse-worker` 4.78.0, `clickhouse-server` 26.3.62.3 sobem saudáveis; exigem `HOSTNAME=0.0.0.0` para o healthcheck em `127.0.0.1`                                                                                            |
| MinIO do profile Langfuse             | registro de imagens                                             | `minio/minio` não está mais disponível; usada `cgr.dev/chainguard/minio` (só `latest`), fixada por digest                                                                                                                                  |
| Proxy assinado da Netlify             | Context7 `/websites/netlify`                                    | Claims do JWS: `deploy_context`, `exp`, `iss=netlify`, `netlify_id`, `site_url`; header `x-nf-sign` HS256. O valor real de `deploy_context` num alias via CLI continua para o spike (c)                                                    |

Pendente no (g): as bibliotecas de API e web ainda não introduzidas (Drizzle, Better Auth,
TanStack, shadcn/Base UI, OTel, promptfoo, k6 etc.) são conferidas pelos streams que as
introduzem, nas fases correspondentes.

## Decisão

Pendente. Esta ADR passa a `accepted` quando todos os spikes tiverem resultado e as decisões
decorrentes estiverem aplicadas no plano e nas ADRs afetadas (allowlist de `deploy_context`,
header de IP, formato do entrypoint e do build, glob de `supportsCancellation`, `trustProxy` da
Vercel, versões).

### Consequências

- (e) e parte do (g) já ajustaram o catálogo e a ADR 0002.
- (b) teve o deploy e o `/healthz` concluídos em 2026-11-11 (ver "Spike (b)"), com a decisão na
  [ADR 0017](0017-vercel-build-output-tsdown.md); as verificações manuais de stream seguem abertas.
- Os spikes (a), (c), (d) e (f) dependem dos tokens de deploy e de API, que ainda não existem
  (as contas foram criadas em 2026-11-10). Nenhum resultado deles foi presumido.
