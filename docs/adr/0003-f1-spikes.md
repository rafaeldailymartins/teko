---

status: accepted
date: 2026-11-11
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

| Spike | Pergunta                                                                                                                                                                                                                     | Status                                                              | Resultado                                                                                                                                                                                                                                           | Decisão decorrente                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)   | Build do Next no Actions + `netlify deploy --build --context develop --alias develop` com `NETLIFY_NEXT_PLUGIN_SKIP`: o deploy tem 0 functions e o env por contexto é aplicado?                                              | concluído (2026-11-11)                                              | Sim, no site `tekoia` (ver "Spike (a)"); a Netlify instala o plugin do Next sozinha se ele não for declarado, e troca `/pt-BR/` por `/pt-br/`                                                                                                       | `@netlify/plugin-nextjs` fixado no lockfile; proteção de visitantes desligada no site; o i18n da F5 precisa tratar URL em minúsculas                                                               |
| (b)   | Fastify "hello" com o `server.ts` real no `teko-api-staging`, pelo fluxo do CI (build → tarball atestado → `vercel deploy --prebuilt --prod --skip-domain` → `vercel curl` → `vercel promote`). Ver "Checklist do spike (b)" | concluído (2026-11-11); SIGTERM e cold start sem medição conclusiva | Build Output API pelo tsdown; SSE de 95 s sem corte; promote durante stream; `waitUntil`; desconexão só com `supportsCancellation` (ver "Spike (b)")                                                                                                | [ADR 0017](0017-vercel-build-output-tsdown.md); `supportsCancellation: true` e `maxDuration` de 120 s no `.vc-config.json`; `under-pressure` sem limite de atraso na Vercel                        |
| (c)   | Plugin `context-routing` contra uma rota de echo no `teko-api-staging.vercel.app`. Ver "Checklist do spike (c)"                                                                                                              | concluído (2026-11-11)                                              | `x-nf-sign` verificado, com `deploy_context=branch-deploy` no alias; a Netlify sobrescreve `x-nf-client-connection-ip`; sem cache; +27 ms de mediana (ver "Spike (c)")                                                                              | `NETLIFY_CLIENT_IP_TRUSTED = true` (só com assinatura); allowlist de `deploy_context` em staging = `branch-deploy`; segredo do proxy como variável comum no Netlify Free                           |
| (d)   | Neon `-pooler` com timeouts por role (o pooler não aceita `statement_timeout` como parâmetro de conexão), `attachDatabasePool` e reconexão após scale-to-zero                                                                | concluído (2026-11-11), sem o `attachDatabasePool`                  | Timeouts do role valem pelo pooler; o pooler recusa `statement_timeout` em `options`; primeira query depois de 5,5 min ociosos em 4,7 s, sem erro de reconexão (ver "Spike (d)")                                                                    | Timeouts no role, como no plano; driver e `attachDatabasePool` decididos na F2 (o `pg` nunca teve proveniência)                                                                                    |
| (e)   | Exports `parseJsonEventStream` e `uiMessageChunkSchema` do pacote `ai`                                                                                                                                                       | concluído                                                           | Os dois são exportados pelo entry `ai` (ver "Spike (e)")                                                                                                                                                                                            | O `TicketedChatTransport` pode importar os dois de `ai`; a versão do catálogo precisa respeitar os 7 dias                                                                                          |
| (f)   | Ingestão: Docling ACCURATE contra V2 no Guia 3.2.4, formato do WS de Tabelas Externas, `bge-m3` com dimensão 1024 e plugins locais do promptfoo                                                                              | concluído (2026-11-11)                                              | V1 `ACCURATE` converteu o Guia inteiro (366 páginas, 457 tabelas); o V2 desmonta as tabelas de campos. WS: TXT cp1252 com SHA-1 nos metadados. `bge-m3`: `[n, 1024]`. promptfoo: `hijacking` e `jailbreak` (meta) são remote-only (ver "Spike (f)") | TableFormer V1 `ACCURATE`; custo de embedding pelo `meta.neurons`; red team sem `hijacking`, com `jailbreak:tree` e `jailbreak-templates`; sha256 do arquivo baixado no lugar do MD5 do Ato COTEPE |
| (g)   | Conferência via Context7 de todas as versões da tabela "Ferramentas da raiz" (inclusive a Vercel CLI) e das tabelas de stack de API (inclusive `@vercel/functions`) e web                                                    | concluído no escopo da F1                                           | Ver "Spike (g)"                                                                                                                                                                                                                                     | Versões seguradas e exceções na [ADR 0002](0002-supply-chain-pnpm.md)                                                                                                                              |

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

### Rodada de stream (2026-11-11)

O run 42989881707 foi só o deploy; a rodada de stream é o run 43007922090 (`stream_checks`), mais
duas sondas de desconexão feitas à parte (a do workflow caiu na deployment anterior, ver abaixo).

| Item                                                                            | Resultado                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime (`/api/_spike/runtime`)                                                 | Node `v24.22.2`, `VERCEL_REGION=gru1`, Sensitive de teste presente (só o tamanho, 23), segredo do proxy configurado                                                                                  |
| SSE de 95 s pelo domínio de produção (primeiro byte em 30 s, heartbeat de 15 s) | `start` aos 30,2 s; heartbeats aos 45, 60, 75 e 90 s; `end` aos 95,2 s; `request completed` com 95.005 ms. Sem corte nem buffering                                                                   |
| Promote de uma deployment de produção anterior durante o stream                 | Aos ~40 s o domínio passou para a anterior (`ilctuqbow`); o stream em curso terminou normalmente na atual, e o promote de volta funcionou. É também a prova de promote de deployment antiga no Hobby |
| Propagação do promote                                                           | Uma requisição feita logo depois do "Success" do `vercel promote` ainda caiu na deployment anterior (404, sem as rotas de spike). O workflow agora espera a rota da deployment nova antes de seguir  |
| `waitUntil`                                                                     | Resposta em 2 ms (202); a tarefa pós-resposta terminou 1.501 ms depois (atraso pedido: 1.500 ms)                                                                                                     |
| Desconexão **sem** `supportsCancellation`                                       | Cliente saiu aos 15 s de um SSE de 60 s; nenhum `request.signal` nem `close`, e o stream rodou até o fim (`responseTime` de 60.005 ms)                                                               |
| Desconexão **com** `supportsCancellation` (run 43008973221)                     | `request.signal` e `close` da resposta aos 14,66 s; o Fastify registrou `stream closed prematurely`                                                                                                  |
| SIGTERM                                                                         | Nenhum `shutdown requested` nos logs da janela de 30 min (o Hobby recusa `--since 60m`: retenção curta). Não observado; segue como risco residual, coberto pelo teto de 450 ms do encerramento       |
| Sensitive fora do output                                                        | Por construção: o build não lê env da Vercel (sem `vercel pull` nem `vercel build`), e o pack recusa `.env*`. Não houve varredura do tarball pelo valor                                              |
| Cold start (p95)                                                                | Não medido com rigor. Maior latência observada em `/api/healthz`: 390 ms direto e 939 ms proxiado (15 amostras do Brasil)                                                                            |

Outros achados: o campo `region` dos registros do `vercel logs` (`iad1`, `sfo1`) não é a região
da Function (`gru1`, pelo `x-vercel-id` e pelo `VERCEL_REGION`); o upstream cancelado pela
desconexão (fetch do LLM) só existe na F4; `vercel rollback` não foi rodado (o promote de uma
deployment anterior cobre o mecanismo). O `attachDatabasePool` fica para a F2 (ver "Spike (d)").

## Spike (a): web na Netlify

Site `tekoia` (o `teko-web` nunca existiu, e `teko.netlify.app` é de terceiros), no time
`rafael-daily-santos-martins`, a conta do `NETLIFY_AUTH_TOKEN` do environment `staging`. Run
43009044666 do `spike-web-netlify.yml` (Netlify CLI 27.16.2, isolado em `tools/netlify-cli`).

- **Env por contexto:** o build roda com `CONTEXT=develop` e
  `NEXT_PUBLIC_STREAM_ORIGIN=https://teko-api-staging.vercel.app` (do `[context.develop]` do
  `netlify.toml`). A API da Netlify registra o deploy como `context: branch-deploy`,
  `branch: develop`.
- **0 functions e 0 edge functions** (`getDeploy`).
- **Plugin do Next:** sem declaração, o `netlify build` baixa o `@netlify/plugin-nextjs` do npm
  sem versão fixa e roda o `onPreBuild` dele, mesmo com `NETLIFY_NEXT_PLUGIN_SKIP`. Declarado com
  versão exata (5.16.6, catálogo e `[[plugins]]`), ele vem do lockfile e só faz o skip (ADR 0002).
- **Alias público:** a conta nasce com proteção de visitantes (`sso_login`) em todos os
  contextos, o que exigiria login na Netlify até para a produção; foi desligada no site.
- **Headers:** os do `netlify.toml` valem; o HSTS é o da própria Netlify
  (`max-age=31536000; includeSubDomains; preload`) em `*.netlify.app`.
- **URL em minúsculas:** `/pt-BR/` responde 301 para `/pt-br/`. O i18n da F5
  (`localePrefix: 'always'`) precisa tratar isso.
- **Plano Free:** escopos de env var e valores secretos são só do Pro e do Enterprise (a API
  responde 403). O `NETLIFY_PROXY_JWS_SECRET` fica como variável comum, legível pelo time e
  presente no ambiente do build; o `next.config.ts` e o workflow falham se ele aparecer no bundle.
  Decisão do mantenedor.

## Spike (c): proxy Netlify → Vercel

Run 43009440530 do `spike-proxy.yml` (runner nos EUA) e medição de latência feita do Brasil. A
mesma requisição ao eco `/api/_spike/echo`, direto e pelo `develop--tekoia`, com valores
forjados pelo cliente (`x-nf-client-connection-ip: 198.51.100.7`, `x-forwarded-for: 198.51.100.8`).

|                                 | direto (Vercel)                                         | proxiado (Netlify → Vercel)                                                                                                               |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `x-nf-sign`                     | ausente                                                 | presente e **verificado** com o `NETLIFY_PROXY_JWS_SECRET` da API                                                                         |
| claims                          |                                                         | `deploy_context: branch-deploy`, `iss: netlify`, `site_url: https://develop--tekoia.netlify.app`, `exp` +5 min, `netlify_id` = ID do site |
| `x-nf-client-connection-ip`     | o forjado passa intacto                                 | **sobrescrito** com o IP real do cliente                                                                                                  |
| `x-forwarded-for` e `x-real-ip` | sobrescritos com o IP de quem conectou (o forjado some) | o IP de saída da Netlify (muda a cada requisição)                                                                                         |
| Cookie e Set-Cookie             | chega e volta                                           | chega e volta                                                                                                                             |
| Cache                           | `x-vercel-cache: MISS`                                  | `cache-status: "Netlify Edge"; fwd=miss`, `x-vercel-cache: MISS`, `receivedAt` diferentes                                                 |

- **Latência** (`/api/healthz`, 15 amostras do Brasil, mín/mediana/máx): direto 116/162/390 ms,
  proxiado 124/189/939 ms; **+27 ms de mediana** pela Netlify. Do Brasil o caminho é Netlify `gru1`
  → Function `gru1`; do runner nos EUA, Netlify `iad1` → Function `gru1`. Longe do corte de 26 s.
- **WAF:** `/api/v1/coverage` direto e sem `x-nf-sign` respondeu 404 (a rota não existe na F1): as
  regras ainda não estão aplicadas; elas e o smoke do efeito chegam na F7.
- **Deployment Protection:** domínio de produção público (200 direto e pelo proxy).
- **Decisões:** `NETLIFY_CLIENT_IP_TRUSTED = true` (o header só vale com assinatura válida, porque a
  chamada direta o deixa passar forjado); a allowlist de `deploy_context` do plugin
  `netlifySignature` (F4) aceita `branch-deploy` em staging, e o valor de produção (`production`,
  esperado) é conferido no primeiro deploy de produção.
- **Falta:** o pior caso de cold start mais o resume do Neon dentro dos 26 s. A F2 fechou sem essa
  medição; ela entra no DoD da F7 (meta de menos de 10 s), com a API real na Vercel.

## Spike (d): Neon pelo `-pooler`

Run 43011617589 do `spike-neon.yml`, com o `psql` do runner (EUA) contra o projeto `teko-staging`
(`sa-east-1`). O role `teko_app` foi criado por SQL pelo mantenedor (pela tela ou pela API, o Neon
o poria no `neon_superuser`), e a URL dele pelo host `-pooler` está no segredo
`NEON_STAGING_APP_URL` do environment `staging`.

| Item                                                                 | Resultado                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Timeouts gravados no role pelo owner (`ALTER ROLE teko_app SET ...`) | `statement_timeout` e `idle_in_transaction_session_timeout` = `5s`, lidos como `teko_app` pelo pooler                            |
| `SELECT pg_sleep(7)` pelo pooler                                     | `ERROR: canceling statement due to statement timeout` (57014)                                                                    |
| `statement_timeout=1s` em `options` na conexão pelo pooler           | Recusado: `unsupported startup parameter in options: statement_timeout. Please use unpooled connection or remove this parameter` |
| Primeira query depois de 5,5 min sem tocar no banco                  | 4.745 ms (conexão nova, com o resume), sem erro; a seguinte, 853 ms (conexão nova do runner nos EUA até `sa-east-1`)             |

- **Confirma o plano:** os timeouts ficam no role (a migração da F2 os grava), porque o PgBouncer do
  Neon não aceita o parâmetro na conexão.
- **Resume:** a primeira query cabe com folga no corte de 26 s do proxy, mesmo somada ao cold start
  da Function. A `NEON_API_KEY_STAGING` é restrita ao projeto (404 ao listar projetos), então a
  espera foi fixa e não houve confirmação pela API de que o compute suspendeu; a diferença entre as
  duas medidas indica que sim. Erros de reconexão (`57P01`, `ECONNRESET`) aparecem com conexões
  de pool reaproveitadas, que o `psql` não tem: o retry único do plano é exercitado na F2.
- **Fica para a F2:** o `attachDatabasePool` (precisa do pool dentro da Function) e o driver: o
  `pg` nunca foi publicado com proveniência, e a regra do repositório a exige para dependência
  nova (ADR 0002).

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

## Spike (f): ingestão

Executado em 2026-11-11, na máquina do mantenedor (Windows, 8 núcleos, sem GPU), com os scripts
de spike fora do repositório. Nenhum segredo passou pelo código: o token do Workers AI ficou no
`tools/ingest/.env` local, fora do git.

### Docling no Guia Prático EFD ICMS/IPI 3.2.4

PDF oficial do [gov.br/sped](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi/manuais-e-documentos-tecnicos/guia-pratico-efd-versao-3-2-4.pdf/@@display-file/file)
(366 páginas, 6,6 MB, sha256 `01e76f17…b6f164`). O portal antigo `sped.rfb.gov.br` para na
3.2.2.

- **MD5 do Ato COTEPE ≠ MD5 do arquivo publicado.** O Ato COTEPE/ICMS 86/2026 dá a chave
  `8DEF286233A4EBF912E9C09EA36E5DBF` para a 3.2.4; o PDF baixado tem MD5
  `aaec227817731c6429375bdcc9e47b84`. A chave do Ato não serve para conferir o download: o
  `sources.yaml` (F3) guarda o sha256 do arquivo efetivamente baixado e registra a chave do Ato só
  como metadado.

Docling 2.146.0 (docling-core 2.105.0, torch 2.15.0+cpu), com as opções do `convert.py` (OCR
desligado, `do_cell_matching=True`, serviços remotos desligados, imagens como placeholder) e os
modelos baixados por `docling-tools models download layout tableformer tableformerv2`:

| Execução                                      | Páginas | Tempo              | s/página | Tabelas | Resultado            |
| --------------------------------------------- | ------- | ------------------ | -------- | ------- | -------------------- |
| V1 `ACCURATE`, amostra (páginas 60–69)        | 10      | 52,7 s             | 5,3      | 7       | `success`            |
| V2 (`TableStructureV2Options`), mesma amostra | 10      | 30,2 s             | 3,0      | 7       | `success`            |
| V1 `ACCURATE`, Guia inteiro                   | 366     | 4.301 s (71,7 min) | 11,8     | 457     | `success`, sem erros |

Na amostra, com as mesmas tabelas de registros (B500, B510, B990, C001, C100...):

| Métrica                                                                                        | V1 `ACCURATE` | V2     |
| ---------------------------------------------------------------------------------------------- | ------------- | ------ |
| Tabelas de campos com cabeçalho reconhecido (`Nº`, `Campo`, `Descrição`, `Tipo`, `Tam`, `Dec`) | 6 de 7        | 0 de 7 |
| Células com número e nome do campo fundidos (`01 REG`)                                         | 0             | 69     |
| `REG` sozinho na coluna `Campo`                                                                | 6             | 0      |
| Descrições de campos vizinhos misturadas (C100: "…"C100" Indicador do tipo de operação")       | não           | sim    |

No Guia inteiro com o V1: 457 tabelas em 310 páginas, 259 tabelas de campos com o cabeçalho
completo, 269 registros distintos (de `0000` a `K990`, pelo "Texto fixo contendo"), 21 células
fundidas e 106 tabelas com cabeçalho genérico, das quais 102 vêm logo depois de outra tabela
(continuação depois da quebra de página, sem repetir o cabeçalho). Saída: `docling.json` de
36,6 MB e Markdown de 1,6 MB.

- **Decisão (mantenedor, 2026-11-11): TableFormer V1 `ACCURATE` com cell matching**, como já está
  no plano e no `convert.py`. O V2 é 43% mais rápido, mas desmonta justamente as tabelas de
  registros e campos, que são o que a ingestão do Guia precisa. A conversão completa com o V2 foi
  interrompida depois da decisão; a comparação é a da amostra.
- **Quebra de página:** o parser `docling-guia` (F3) junta a tabela de cabeçalho genérico à tabela
  de campos anterior, como prevê o teste "Docling JSON com tabela que quebra de página".
- **Tempo:** os 71,7 min foram medidos com a CPU dividida com outras tarefas (média de 2,4 núcleos
  em uso); sem disputa, a amostra projeta uns 32 min. Mesmo assim, o Guia passa do
  `document_timeout` de 3.600 s do plano numa máquina com a CPU disputada. A F3 mede no runner do
  Actions e, se a conversão passar do timeout, sobe o `document_timeout` do Guia ou o divide por
  `page_range` (o mesmo mecanismo previsto para documentos de mais de 5 h).

### WS de Tabelas Externas

`https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/WsConsulta.asmx` (ASMX/IIS, SOAP 1.1,
1.2 e HTTP GET/POST no WSDL). Consulta por GET, sem autenticação, em 0,27 s:

| Item                               | Resultado                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operações                          | `consultarVersoesTabelasExternas(codigoSistema)` e `consultarVersoesTabelasExternasPorData(codigoSistema, dataReferencia)`                                        |
| Retorno                            | `RetornoVersoesTabelasExternas`: `codigoRetorno` (101 = ok), `mensagemErro`, `urlDownloadArquivo` e `metadadosXml` (XML escapado dentro do XML)                   |
| Metadados (`SpedFiscal`)           | `<tabelas dthc="2026-11-09" versao="1959">`, 188 tabelas em pacotes por UF; cada `<tabela>` tem `id`, `tipo`, `desc`, `versao`, `dtCriacao`, `dtVersao` e `hash`  |
| Tabelas de Goiás (`SPEDFISCAL_GO`) | 5.1.1 (`id` 37, versão 151), 5.2 (38, v51), 5.3 (39, v47), 5.5 (40, v5), além de Códigos de Receita (187, v10)                                                    |
| Download                           | `obterTabela.ashx?idTabela=<id>&versao=<versao>` → `application/txt`, `Content-Disposition: attachment; filename=Id37$V151.txt`                                   |
| `hash`                             | SHA-1 do arquivo baixado; conferiu nas quatro tabelas de Goiás                                                                                                    |
| Formato                            | TXT em **cp1252** (não é UTF-8; tem `–` em 0x96), CRLF; 1ª linha `versão=151 COD_AJUR, DESC_AJUR, DT_INI, DT_FIM`; linhas `codigo                                 | descricao | DDMMAAAA | DDMMAAAA`, `DT_FIM` vazio = vigente |
| Histórico                          | Versões antigas continuam disponíveis (`versao=1` e `versao=150` da 5.1.1). A v1 tem cabeçalho só `versão=1.0`, sem nomes de colunas                              |
| Vigência por linha                 | Na 5.1.1 v151, 163 códigos aparecem em mais de uma linha, com períodos diferentes (ex.: `GO359999` em 2017–2018 e de 2019 em diante); 447 linhas sem `DT_FIM`     |
| Erros                              | Versão inexistente ou parâmetro errado voltam **HTTP 200** com `text/html` e corpo `Erro o obter Tabela:VERSAO_TABELA_EXTERNA_NAO_ENCONTRADA` (ou `..._INVALIDA`) |

### `bge-m3` no Workers AI

Conta no Workers Free, token criado pelo template "Workers AI" (`Workers AI - Read` e `Edit`).
`POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/baai/bge-m3` com
`{ "text": [...] }`:

| Lote                       | HTTP | Latência | `shape`       |
| -------------------------- | ---- | -------- | ------------- |
| 1 texto (primeira chamada) | 200  | 516 ms   | `[1, 1024]`   |
| 3 textos                   | 200  | 185 ms   | `[3, 1024]`   |
| 50 textos                  | 200  | 282 ms   | `[50, 1024]`  |
| 101 textos                 | 200  |          | `[101, 1024]` |

- **Dimensão 1024** em todos os vetores, valores finitos, norma ≈ 1 (0,9997–0,9999), `pooling: "cls"`.
  O `halfvec(1024)` do plano vale.
- **Determinístico:** o mesmo texto repetido deu cosseno 1,000000.
- **Custo real na resposta:** `result.meta` traz `cost_metric_name_1: "input_tokens"`, o valor e
  `neurons` (5 tokens → 0,00537 neuron, ≈ 1.075 neurons por milhão de tokens), e o header
  `cf-ai-neurons` traz o mesmo valor arredondado. O orçamento de 8.000 neurons/dia da ingestão
  cobre ≈ 7,4 milhões de tokens por dia. A estimativa `ceil(chars/3)` deu os mesmos 5 tokens para
  `Registro C100`.
- O lote de 50 do plano cabe com folga (101 também passou).

### promptfoo 0.125.1 com geração remota desligada

Instalado isolado no scratchpad (pnpm com `minimumReleaseAge` de 7 dias e `trustPolicy:
no-downgrade`; a 0.125.1 é de 2026-10-25 e tem proveniência SLSA v1), com
`PROMPTFOO_DISABLE_REMOTE_GENERATION=true`, `PROMPTFOO_DISABLE_SHARING=1` e
`PROMPTFOO_DISABLE_TELEMETRY=1`. `promptfoo redteam plugins` lista 155 plugins sem dizer quais
são remote-only; a lista veio de `REMOTE_ONLY_PLUGIN_IDS` no pacote e da documentação (Context7
`/websites/promptfoo_dev`). A prova foi um `redteam run` completo, com um provider local falso
como `redteam.provider` e juiz, contra um alvo `echo`:

| Item do plano                                                                                    | Resultado sem geração remota                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt-extraction`, `pii:direct`, `overreliance`, `hallucination`, `excessive-agency`, `policy` | geram casos em `en` e `pt-BR`                                                                                                                |
| `hijacking`                                                                                      | **remote-only**: `hijacking plugin requires remote generation`, 0 casos                                                                      |
| `base64`, `leetspeak`                                                                            | ok na geração e na avaliação                                                                                                                 |
| `prompt-injection`                                                                               | ok, mas **obsoleta** ("use `jailbreak-templates`")                                                                                           |
| `jailbreak`                                                                                      | **obsoleta**; na avaliação vira `promptfoo:redteam:iterative:meta`, que é remote-only (`jailbreak:meta strategy requires remote generation`) |
| `jailbreak-templates`, `jailbreak:tree`                                                          | ok na geração e na avaliação (o `tree` itera com o `redteam.provider`)                                                                       |
| `jailbreak:composite`, `jailbreak:likert`                                                        | remote-only                                                                                                                                  |

A documentação lembra que a variável não isola a rede (telemetria e sharing têm variáveis
próprias, já previstas no plano).

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

| Item                                                                                                          | Fonte                                                                            | Resultado                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@fission-ai/openspec`                                                                                        | Context7 `/fission-ai/openspec` + CLI local 1.16.0                               | `init --tools claude --language`, `config.yaml` (`schema`, `context`, `rules`) e `validate --strict` conferem com o plano; versão 1.16.0 (1.17.0 segurada pela regra de 7 dias)                                                            |
| pnpm 12 (settings de supply chain)                                                                            | Context7 `/pnpm/pnpm/v12.15.0`                                                   | `trustPolicy`, `trustPolicyExclude`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds` e `catalogMode` existem com a semântica usada                                                                                                |
| Turborepo                                                                                                     | Context7 `/vercel/turborepo/v2.11.10` (stream da raiz)                           | Versão 2.11.10 conferida; configuração do `turbo.json` escrita a partir dessa documentação                                                                                                                                                 |
| Biome                                                                                                         | Context7 `/biomejs/biome` e `/biomejs/website` (stream da raiz)                  | Versão 2.6.4 no catálogo (2.6.6 segurada pela regra de 7 dias); `biome.json` escrito a partir dessa documentação                                                                                                                           |
| Vercel (plataforma e CLI)                                                                                     | Context7 `/websites/vercel`                                                      | Hobby: 300 s, 2 GB / 1 vCPU, uma região de Functions, 1.024 file descriptors; `vercel build` + `vercel deploy --prebuilt --prod`; `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`; `@vercel/functions` atual documenta `getDeadline`, ausente na 3.7.6 |
| Render (Plano B)                                                                                              | Context7 `/websites/render`                                                      | 750 instance-hours por workspace, spin-down após 15 min, cerca de 1 min para voltar, suspensão sem forma de pagamento                                                                                                                      |
| uv                                                                                                            | Context7 `/astral-sh/uv/0.13.5`                                                  | `exclude-newer` aceita duração relativa (`1 week`, `7 days`, `P7D`)                                                                                                                                                                        |
| `pgvector/pgvector:0.8.6-pg18-trixie`                                                                         | `docker buildx imagetools inspect` + teste local                                 | Digest `sha256:78bf48b8…`; PostgreSQL 18.6, extensão `vector` 0.8.6, `PGDATA=/var/lib/postgresql/18/docker`                                                                                                                                |
| Caddy (só o proxy de dev local)                                                                               | Context7 `/websites/caddyserver_caddyfile` + imagem                              | A tag atual é `2.11.9-alpine` (digest `sha256:0bbb055b…`); `header_up`, `request_body`, `response_header_timeout` e `{env.*}` conferidos. Em produção não há Caddy                                                                         |
| Langfuse self-hosted (só dev local)                                                                           | Context7 `/websites/langfuse_self-hosting` + teste local                         | `langfuse`/`langfuse-worker` 4.78.0, `clickhouse-server` 26.3.62.3 sobem saudáveis; exigem `HOSTNAME=0.0.0.0` para o healthcheck em `127.0.0.1`                                                                                            |
| MinIO do profile Langfuse                                                                                     | registro de imagens                                                              | `minio/minio` não está mais disponível; usada `cgr.dev/chainguard/minio` (só `latest`), fixada por digest                                                                                                                                  |
| Proxy assinado da Netlify                                                                                     | Context7 `/websites/netlify`                                                     | Claims do JWS: `deploy_context`, `exp`, `iss=netlify`, `netlify_id`, `site_url`; header `x-nf-sign` HS256. O valor real de `deploy_context` num alias via CLI continua para o spike (c)                                                    |
| Lint e CI (knip, sherif, dependency-cruiser, Steiger, commitlint, Lefthook, GitHub Actions, zizmor, Gitleaks) | Context7 (IDs na tabela "Fontes Context7" de `setup-quality-gates-ci/design.md`) | Conferidos no fechamento. Única divergência: o Steiger ligava `no-cross-imports` sem desligar a `forbidden-imports` do `recommended`; a configuração passou às duas regras granulares, como manda a doc. O sherif não tem ID no Context7   |

Fora do escopo do (g) na F1: as bibliotecas de API e web ainda não introduzidas (Drizzle, Better Auth,
TanStack, shadcn/Base UI, OTel, promptfoo, k6 etc.) são conferidas pelos streams que as
introduzem, nas fases correspondentes.

## Decisão

Aceita em 2026-11-11: os sete spikes têm resultado registrado e as decisões decorrentes estão
aplicadas no código, no plano e nas ADRs afetadas (allowlist de `deploy_context`, header de IP,
formato do entrypoint e do build, `supportsCancellation` no `.vc-config.json`, `trustProxy` da
Vercel, versões). O (g) cobre o que a F1 introduziu: as bibliotecas ainda não introduzidas são
conferidas via Context7 pelas fases que as introduzem.

As rotas temporárias `/api/_spike/*` e a Sensitive de teste `TEKO_SPIKE_SENSITIVE` saíram da API
no fechamento. Os workflows `spike-api-vercel.yml` e `spike-proxy.yml` ficam só com os passos
que não dependem delas (build, tarball atestado, deploy, smoke, promote, WAF, latência e cache),
como referência para a F7.

### Consequências

- (e) e parte do (g) ajustaram o catálogo e a ADR 0002.
- (a), (b), (c) e (d) aplicaram as decisões no código, no plano e na
  [ADR 0017](0017-vercel-build-output-tsdown.md).
- (f) confirmou a configuração do Docling e o `halfvec(1024)`, e ajustou no plano o formato das
  Tabelas Externas, a contabilidade de neurons e a lista de plugins e estratégias do red team.

### Riscos residuais

Ficam registrados como estão, sem medição adicional na F1:

- **SIGTERM e cold start** não foram medidos com rigor na Vercel (spike (b)); o teto de 450 ms do
  encerramento e as chamadas curtas cobrem o risco, e o DoD da F7 volta a medir.
- **`attachDatabasePool` e o driver do Postgres** ficam para a F2: o `pg` nunca foi publicado com
  proveniência, e a regra do repositório a exige para dependência nova (spike (d)).
- **WAF** não foi aplicado na F1; as regras e o smoke do efeito chegam na F7 (spike (c)).
- **`/pt-br/` em minúsculas**: a Netlify redireciona `/pt-BR/`, e o i18n da F5 precisa tratar
  isso (spike (a)).
- **Pior caso de cold start + resume do Neon** dentro do corte de 26 s do proxy não foi medido
  na F2 e fica para o DoD da F7 (spikes (c) e (d)); as medidas separadas cabem com folga.
