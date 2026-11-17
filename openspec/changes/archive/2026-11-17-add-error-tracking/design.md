# Design

## Context

Arquitetura em `docs/architecture/observabilidade.md` (Erros e PostHog) e `frontend.md` (CSP e
PostHog). A API é uma Function da Vercel em Fluid compute (instância congelada entre invocações,
trabalho pós-resposta só por `BackgroundTasks`); o web é um export estático com CSP por documento e
o `posthog-js` carregado só depois do consentimento. A política publicada diz que o registro de
erros é legítimo interesse e não grava nada no navegador. Orçamento do primeiro acesso: 500 KiB gz.

Documentação consultada no Context7 (IDs):

- `/posthog/posthog.com`: `captureException` no Node (`posthog-node`, `distinct_id` e propriedades,
  flush em serverless) e na web (`posthog.captureException(error, properties)`, erro já ocorrido com
  a pilha dele); upload de source maps pelo `posthog-cli` (`sourcemap inject` e `upload`, release,
  `POSTHOG_CLI_API_KEY` com `error tracking write` e `organization read`, host
  `https://eu.posthog.com`); CSP tracking (`report-uri <host>/report/?token=<chave>`,
  `report-to posthog`, `Reporting-Endpoints`, também em `Content-Security-Policy-Report-Only`);
  persistência (`persistence: 'memory'`) e cookieless (`cookieless_mode: 'always'` depende de
  configuração do projeto); eventos anônimos (`$process_person_profile: false`); API de captura
  (`POST /i/v0/e/`); plano Free com um projeto e 100 mil exceções por mês; o slim bundle com
  `ErrorTrackingExtensions` (experimental, descartado).

## Goals / Non-Goals

**Goals:** erros da API e do navegador sem PII no PostHog da UE, com `trace_id` e release; pilha
resolvida pelos source maps; relatórios de CSP e Trusted Types; o evento do `source-watch`; nada no
navegador antes de um erro e nada gravado nele.

**Non-Goals:** o pipeline de deploy (F7) que chama o upload; o enforce do Trusted Types (F10); a
erasure no PostHog (`add-product-analytics`); o tracing do Langfuse (`add-llm-tracing-langfuse`).

## Decisions

- **Só `internal` vai ao destino.** O error handler chama o hook com `problem.code === internal`: os
  4xx são esperados e os 503 deliberados (`service_paused` do kill switch e do `under-pressure`,
  `upstream_unavailable`) já têm métricas e alertas; reportá-los encheria a cota do Free.
- **Envio imediato, flush só com erro.** O adapter usa `captureExceptionImmediate` e guarda a promise;
  o `flush` só a espera, e o adapter HTTP o agenda em `BackgroundTasks` (500 ms) quando reportou. O
  `captureException` com fila não serve: o `flush()` do SDK não espera a promise que monta o evento.
- **Scrubber na cópia, e o `before_send` tira o código-fonte.** O erro sai como uma cópia
  (`ScrubbedError`) com nome, mensagem (PII pelo `PiiRedactor`, credenciais de URL, 500 caracteres)
  e pilha. O `posthog-node` lê do disco as linhas em volta de cada frame (`context_line`), que podem
  repetir um literal do código: o `before_send` as remove, e a pilha se resolve pelos source maps.
- **`distinct_id` = `trace_id`.** A doc recomenda um id aleatório por visita em vez de um id fixo
  para eventos anônimos; o `trace_id` é aleatório, técnico e já liga o erro ao trace. Com
  `$process_person_profile: false` e `disableGeoip`, não cria perfil nem localiza.
- **Host fixo no código.** `https://eu.i.posthog.com`, como os hosts dos provedores de LLM; só a
  chave vem do ambiente (`POSTHOG_PROJECT_KEY`, Sensitive).
- **Release.** `teko@X.Y.Z` na produção (tag `v*`) e `teko@<sha7>` nos demais
  (`errorTrackingRelease`); vai como propriedade `release` (API e web) e nomeia o upload dos source
  maps (`--release-name teko --release-version X`). Staging e produção dividem o único projeto do
  Free; `app_env` e o release separam.
- **Navegador: handler mínimo e SDK sob demanda.** O `instrumentation-client.ts` instala o handler
  (`error-capture.ts`, poucas centenas de bytes) antes da aplicação; no primeiro erro, `import()` do
  `error-client.ts`, que inicializa uma instância nomeada (`teko_errors`) do mesmo
  `module.no-external` do analytics (um chunk só) e chama `captureException(erro)`: o SDK recebe o
  `Error` já ocorrido, com a pilha dele. Configuração: `persistence: 'memory'`,
  `disable_persistence`, `person_profiles: 'never'`, sem autocapture, pageview, flags, replay,
  pesquisas nem captura automática de exceções, sem compressão (o e2e confere o corpo).
  `cookieless_mode: 'always'` foi descartado: depende de uma opção do projeto e não acrescenta nada à
  memória. O slim bundle com `ErrorTrackingExtensions` também (experimental, e duplicaria o SDK
  quando o analytics também carrega).
- **O que o navegador reporta.** Erros não tratados (`error` com `ErrorEvent`, sem os de recurso;
  `unhandledrejection`), os `ErrorBoundary` e as consultas e mutações do TanStack Query que falham
  com `ApiError` `internal` com status (um 500 que a API devolveu, com o `trace_id` dela); falha de
  rede e os erros esperados ficam de fora. O mesmo erro sai uma vez, no máximo 10 por página.
- **Chave dos erros separada.** `NEXT_PUBLIC_POSTHOG_KEY` só vai à produção (o analytics fica
  desligado no staging). Os erros e os relatórios de CSP precisam do staging (o enforce do Trusted
  Types depende de 14 dias sem violação lá), então usam `NEXT_PUBLIC_POSTHOG_ERRORS_KEY`, com o mesmo
  valor (um projeto só) nos dois builds.
- **CSP.** `report-uri` (navegadores sem Reporting API) e `report-to posthog` nas duas políticas, e
  o `Reporting-Endpoints` como terceiro header do manifesto. O `parseHeadersManifest` aceita esse
  header só no formato `nome="https://…"` (sem aspas internas, crase nem barra invertida), e o Caddy
  escreve o valor entre crases. A chave passa por `^phc_[A-Za-z0-9_]+$` antes de entrar na CSP.
- **`posthog-cli` isolado e sem `postinstall`.** O pacote do npm é o instalador do cargo-dist: o
  `postinstall` baixa o binário de `releases.posthog.com` sem checksum. Fica `allowBuilds: false`, e
  o `install-binary.mjs` baixa o artefato do GitHub Releases e confere o sha256 fixado (o `digest`
  do asset). Linux x64 (CI) e Windows x64 (mantenedor).
- **`inject` offline por construção.** Medido no 0.19.0: o `inject` exige credencial (qualquer
  `phx_…`), e com release (flags, git do diretório de trabalho ou CI) chama a API para resolvê-lo;
  sem release injeta só os chunk ids, determinísticos e idempotentes. O script roda num diretório
  temporário fora do repositório, com ambiente mínimo (sem `GITHUB_*`), credencial de mentira e
  proxy inalcançável. O snippet injetado só registra o chunk id em `globalThis._posthogChunkIds`;
  a API injetada sobe e responde o `/healthz`, e o e2e roda sobre o web injetado.
- **Onde o `inject` roda.** Na stack de CI (`up.sh`, só o web: a API é buildada no Docker) e no
  deploy (composite `posthog-sourcemaps`, web e API, antes do `build-vercel-output`). Não roda no
  `pnpm build` (dev, Render, Docker), que não tem o binário: o build continua igual, com os `.map`.
- **`.map` nunca servidos.** O `build-vercel-output` não os copia para o `static/` (a Function
  continua com os da API, que não são públicos), o Plano B os recusa (`allowedPath`) e o Caddy
  responde 404 (`error @source_map 404`).
- **`source-watch`.** Um `curl` à API de captura com a chave do projeto (variável
  `POSTHOG_PROJECT_KEY` do environment `staging`), `distinct_id` por run e sem perfil; sem a chave,
  aviso; falha do PostHog, aviso. Harden-runner com `eu.i.posthog.com:443`.

## Risks / Trade-offs

- O primeiro acesso ganha o handler e um snippet de chunk id por chunk (medido no fechamento).
- Errors de staging e produção no mesmo projeto: filtros por `release`/`app_env` nos painéis.
- O Plano B não injeta os chunk ids: pilhas minificadas lá.
- Um erro que acontece antes do `instrumentation-client.ts` (no próprio chunk dele) não é capturado.
- O PostHog não documenta o Trusted Types à parte; o staging confirma que as violações de
  `require-trusted-types-for` chegam pelo mesmo endpoint.
