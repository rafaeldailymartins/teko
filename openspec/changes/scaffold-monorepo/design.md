# Design

## Context

Ver `proposal.md` para a motivação. Restrições que moldam o desenho: custo zero, mantenedor solo,
Windows 11 como máquina de desenvolvimento (comandos POSIX via Git Bash), API que só aceita
chamadas com `x-nf-sign` válido, API publicada como uma Vercel Function no Hobby (ADR 0004) e um
plano que fixa versões exatas conferidas via Context7, com o catálogo do pnpm como fonte da
verdade.

## Goals / Non-Goals

**Goals:**

- Três pacotes JS (`@teko/web`, `@teko/api`, `@teko/shared`) sem `package.json` extra para
  testes, k6 ou promptfoo; scripts da raiz em TypeScript executados pelo Node 24 sem build.
- Instalação determinística e endurecida contra ataques de cadeia de suprimentos.
- Stack local subindo com dois comandos e sem segredo no repositório.

**Non-Goals:**

- Stack de CI (`infra/ci`, F4) e configuração dos projetos Vercel (`infra/vercel`, F7).
- Migrações e roles do banco (`teko_app`, `teko_watch`), que chegam na F2.

## Decisions

- **pnpm 12 com catálogo estrito** em vez de npm/yarn: catálogo único, `minimumReleaseAge`,
  `trustPolicy` e `allowBuilds` nativos. `devEngines.packageManager` e `configDependencies` ficam
  proibidos porque geram lockfile de dois documentos que o grafo de dependências do GitHub não lê.
  Detalhes, exceções e versões seguradas pela regra de 7 dias na ADR 0002.
- **Vercel sem exceção no workspace da aplicação.** Desde ago/2026 a Vercel publica `vercel` e
  todo `@vercel/*` só com trusted publisher, sem proveniência SLSA, e o `trustPolicy:
  no-downgrade` os recusa. Alternativas: (1) `trustPolicyExclude` de `@vercel/*` na raiz,
  descartada porque afrouxa a política do código que roda em produção; (2) desligar o
  `trustPolicy`, descartada pelo mesmo motivo. Escolha: `@vercel/functions` 3.7.6 (última com
  proveniência; não exporta `getDeadline`, então o prazo vem do `maxDuration` configurado) e o
  Vercel CLI 65.11.0 num projeto pnpm isolado em `tools/vercel-cli`, com as exceções `vercel`,
  `@vercel/*`, `undici@5.29.0` e `semver@6.3.1` e `allowBuilds` negando `esbuild` e `koffi`.
- **Hooks chamam `./node_modules/.bin/*`** em vez de `pnpm exec`, para funcionar sem `pnpm` no
  PATH (Corepack sem `enable`).
- **knip em dois modos**: o padrão (projeto inteiro, com testes) e `--production` restrito a
  `dependencies,unlisted,unresolved,binaries`, que pega dependência de runtime usada só em teste.
- **`.gitignore` ancorado.** O padrão `out/` ignorava `apps/api/src/adapters/out`; agora é
  `/apps/web/out/`.
- **Cooldown também no Python**: `exclude-newer = "7 days"` no `[tool.uv]` de `tools/ingest`,
  equivalente ao `minimumReleaseAge` do pnpm.
- **`@teko/shared` just-in-time** (exporta `.ts`), embutido na API pelo tsdown e transpilado pelo
  Next. Alternativa: build próprio com `dist/`; descartada por somar um passo sem ganho.
- **Build Output API a partir do bundle do tsdown** em vez do builder zero-config do Fastify: no
  spike (b), o zero-config manteve os imports `.ts` no `server.js` e a Function caiu com
  `ERR_MODULE_NOT_FOUND`. `scripts/build-vercel-output.ts` monta `.vercel/output` com uma Function
  `index` (`nodejs24.x`, launcher `Nodejs`, streaming, `maxDuration` igual a
  `FUNCTION_MAX_DURATION_S`), o `dist/server.mjs` como handler e as dependências de produção do
  `pnpm deploy` hoisted; o CI não roda `vercel pull` nem `vercel build`. Alternativas e
  consequências na ADR 0017.
- **Rotas temporárias `/api/_spike/*`** para os spikes (b) e (c): SSE com primeiro byte atrasado e
  heartbeat, eco do proxy assinado (claims do `x-nf-sign`, IPs, nomes de cookies), runtime e
  `waitUntil`. Existiram só com `APP_ENV=staging` e `RUNTIME_TARGET=vercel`, nunca devolveram
  valor de segredo e foram removidas no fechamento da F1, junto com a Sensitive de teste
  `TEKO_SPIKE_SENSITIVE`; os workflows de spike ficam só com os passos que não dependem delas,
  como referência para a F7. Alternativa: uma Function à parte só para o spike; descartada porque
  mediria outra coisa, e não o `server.ts` real.
- **Spike (d) com `psql` do runner**, sem `pg` na API: o `pg` nunca foi publicado com proveniência,
  e a regra do repositório exige proveniência para dependência nova. A decisão sobre o driver
  fica para a F2; o `attachDatabasePool`, que depende do pool dentro da Function, também.
- **Proxy de dev com Caddy em contêiner**, não um middleware no `next dev`: o export estático
  proíbe `proxy.ts`/middleware, e os rewrites do Next não injetam headers. O Caddy sobrescreve
  (`header_up` sem `+`) os três headers da Netlify; remoções com curinga foram evitadas porque o
  Caddy aplica deletes depois dos sets e apagaria os headers injetados. Esse Caddy existe só no
  dev local, simulando o proxy da Netlify; em produção não há Caddy. Limites: corpo de 32 KB (o
  mesmo `bodyLimit` do Fastify) e `response_header_timeout 26s`, aproximando o corte do proxy da
  Netlify. O upstream é `host.docker.internal:4000` (com `host-gateway` para Linux).
- **JWS estático assinado pelo `dev:secrets`** em vez de assinar por requisição: o Caddy padrão não
  assina JWS, e um plugin exigiria build próprio da imagem. O token dura 7 dias e é renovado pelo
  mesmo comando; o segredo vive só em `apps/api/.env` (a API valida) e o token só em
  `infra/local/.env` (o Caddy injeta via `{env.DEV_STATIC_JWS}`).
- **Segredos nunca sobrescritos.** O script só acrescenta chaves ausentes; o único valor substituído
  é o token derivado. Antes de escrever, `git check-ignore` confirma que o destino está ignorado
  (um `.env` rastreado conta como não ignorado e aborta).
- **PostgreSQL 18 com volume em `/var/lib/postgresql`**: a partir do 18, a imagem oficial usa
  `PGDATA=/var/lib/postgresql/18/docker` e declara o `VOLUME` no diretório pai.
- **Imagens por digest** (tag mantida para leitura), resolvidas com
  `docker buildx imagetools inspect` em 2026-11-10: `pgvector/pgvector:0.8.6-pg18-trixie`,
  `caddy:2.11.9-alpine`, `langfuse/langfuse(-worker):4.78.0`,
  `clickhouse/clickhouse-server:26.3.62.3`, `postgres:17.11-alpine`, `redis:7.4.12-alpine` e
  `cgr.dev/chainguard/minio:latest` (a MinIO deixou de publicar imagens; a Chainguard só oferece
  `latest` gratuitamente).
- **Langfuse local por profile**, com headless initialization (org, projeto, chaves e usuário) e
  `AUTH_DISABLE_SIGNUP`. Portas: UI em `127.0.0.1:3100` (3000 é do `next dev`) e MinIO em
  `127.0.0.1:9090` para as presigned URLs de mídia. `HOSTNAME=0.0.0.0` é necessário porque o
  servidor do Langfuse escuta no hostname do contêiner e o healthcheck usa `127.0.0.1`.

## Risks / Trade-offs

- [Porta 5432 ocupada na máquina] → `TEKO_PG_PORT` em `infra/local/.env`, ajustada antes do primeiro
  `pnpm dev:secrets` (a `DATABASE_URL` é derivada dela). No Windows, faixas reservadas pelo Hyper-V
  (`netsh interface ipv4 show excludedportrange protocol=tcp`) também bloqueiam portas.
- [Token de dev expira em 7 dias] → o próprio comando renova e avisa para recriar o proxy.
- [`latest` da MinIO fixado por digest envelhece] → só afeta o profile opcional de dev; o
  Dependabot de Docker atualiza o digest.
- [Senha do Redis do Langfuse visível em `docker inspect`] → aceitável: stack local, só em
  `127.0.0.1`, segredos descartáveis.

## Fontes Context7

| Biblioteca                | ID Context7                                               | Versão conferida               | Tópicos                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm                      | `/pnpm/pnpm/v12.15.0`                                     | 12.15 (docs) / 12.18.0 (usado) | `trustPolicy`, `trustPolicyExclude`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds`, `catalogMode`                                                                                                                                                                                                                                                                                                                     |
| Caddy (Caddyfile)         | `/websites/caddyserver_caddyfile`                         | 2.11                           | `reverse_proxy` (`header_up`, `flush_interval`, `transport http` → `response_header_timeout`), `request_body max_size`, placeholders `{env.*}`                                                                                                                                                                                                                                                                                   |
| Docker Compose            | `/docker/compose`                                         | v5.x                           | carga do `.env` do diretório do projeto com `-f` em subdiretório, interpolação `${VAR:?}`                                                                                                                                                                                                                                                                                                                                        |
| Postgres (imagem oficial) | `/docker-library/postgres`                                | 18                             | mudança de `PGDATA` e do `VOLUME` no PG 18+                                                                                                                                                                                                                                                                                                                                                                                      |
| Netlify                   | `/websites/netlify`                                       | docs atuais                    | claims do JWS do proxy assinado (`deploy_context`, `exp`, `iss`, `netlify_id`, `site_url`), header `x-nf-sign` HS256                                                                                                                                                                                                                                                                                                             |
| Netlify CLI e API         | `/netlify/cli`, `/netlify/open-api`                       | 27.16.2                        | `netlify deploy` (`--build`, `--context`, `--alias`, `--filter`, `--json`, `NETLIFY_SITE_ID` como padrão de `--site`), `listSites` por nome e `getDeploy` (spike F1 (a))                                                                                                                                                                                                                                                         |
| Langfuse (self-hosting)   | `/websites/langfuse_self-hosting`                         | v4                             | variáveis de web/worker, ClickHouse, Redis `noeviction`, MinIO e mídia, headless initialization, healthchecks com `wget`, upgrade v3→v4                                                                                                                                                                                                                                                                                          |
| Node.js                   | `/websites/nodejs_latest-v24_x_api`                       | 24.x                           | `crypto.randomBytes`, `createHmac`, encoding `base64url`, `fs.writeFileSync` (`mode` só em arquivo novo)                                                                                                                                                                                                                                                                                                                         |
| OpenSpec                  | `/fission-ai/openspec`                                    | 1.16.0                         | formato de delta e regras do modo estrito                                                                                                                                                                                                                                                                                                                                                                                        |
| Turborepo                 | `/vercel/turborepo/v2.11.10`                              | 2.11.10                        | `turbo.json` (`futureFlags.affectedUsingTaskInputs`, `envMode` estrito, `--affected`), conferido pelo stream da raiz                                                                                                                                                                                                                                                                                                             |
| Biome                     | `/biomejs/biome` e `/biomejs/website`                     | 2.6.4                          | `biome.json` (domínios, `noRestrictedImports`, formatação de Markdown), conferido pelo stream da raiz                                                                                                                                                                                                                                                                                                                            |
| Vercel                    | `/websites/vercel`                                        | docs atuais                    | limites do Hobby (300 s, 2 GB / 1 vCPU, uma região), `vercel build` + `vercel deploy --prebuilt`, `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, API de `@vercel/functions` (`waitUntil`, `attachDatabasePool`, `getDeadline` documentado nas versões atuais e ausente na 3.7.6); Build Output API v3 (`config.json`, `.vc-config.json` com `launcherType: "Nodejs"`, `supportsResponseStreaming`, `maxDuration`) e `supportsCancellation` |
| Render                    | `/websites/render`                                        | docs atuais                    | instância Free do Plano B (750 h, spin-down em 15 min, suspensão sem forma de pagamento)                                                                                                                                                                                                                                                                                                                                         |
| uv                        | `/astral-sh/uv/0.13.5`                                    | 0.13.x                         | `exclude-newer` com duração relativa (cooldown de 7 dias) e `exclude-newer-package`                                                                                                                                                                                                                                                                                                                                              |
| AI SDK (`ai`)             | `/vercel/ai/ai_7.0.0`                                     | 7.0.162 / 7.0.169              | transports customizados; exports `parseJsonEventStream` e `uiMessageChunkSchema` conferidos no pacote publicado (spike e, ADR 0003)                                                                                                                                                                                                                                                                                              |
| Docling                   | `/docling-project/docling/v2.141.0`                       | 2.146.0 (usado)                | `PdfPipelineOptions`, `TableStructureOptions` (`TableFormerMode.ACCURATE`, `do_cell_matching`), motor `docling_tableformer_v2` e `docling-tools models download`; `TableStructureV2Options` conferido no pacote instalado (spike f)                                                                                                                                                                                              |
| Cloudflare Workers AI     | `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` | docs atuais                    | token pelo template "Workers AI" (permissões `Workers AI - Read` e `Workers AI - Edit`), Account ID, REST `ai/run/@cf/baai/bge-m3`                                                                                                                                                                                                                                                                                               |
| promptfoo                 | `/websites/promptfoo_dev`                                 | 0.125.1                        | `PROMPTFOO_DISABLE_REMOTE_GENERATION`, plugins e estratégias remote-only (`hijacking`, `jailbreak:meta`, `jailbreak:composite`, `jailbreak:likert`), conferidos no pacote no spike (f)                                                                                                                                                                                                                                           |
