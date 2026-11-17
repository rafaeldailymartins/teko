# Status das fases

Atualize este arquivo no PR que fecha cada fase, spike ou pendência. O que cada fase entrega está
no [roteiro](roadmap.md); o desenho, em [`architecture/`](architecture/README.md).

## Resumo

| Fase                                    | Situação                                     |
| --------------------------------------- | -------------------------------------------- |
| F0 contas e governança                  | concluída, menos o primeiro PR do Dependabot |
| F1 esqueleto, gates e spikes            | concluída em 2026-11-11                      |
| F2 domínio de vigência, schema e busca  | concluída em 2026-11-11                      |
| F3 ingestão C1 e C2, embeddings e watch | fechada em 2026-11-13                        |
| Revisão antes da F4                     | concluída em 2026-11-13                      |
| F4 API completa                         | concluída em 2026-11-14                      |
| F5 frontend completo                    | concluída em 2026-11-15                      |
| F6 observabilidade                      | concluída em 2026-11-17, conferência na F7   |
| F7 em diante                            | a fazer                                      |

## F0: contas e governança

Repositório, rulesets, segurança, App de release, environments, Scorecard (7,4) e `/healthz` dos
dois projetos Vercel conferidos em 2026-11-11. O spike de environments em `pull_request` mostrou
que a regra é avaliada contra `refs/pull/N/merge` (ADR 0024). O environment `maintenance` (só
`develop`, hoje `main`) foi criado em 2026-11-11. O `dependabot.yml` estava inválido (o GitHub
recusa `semver-*-days` no `cooldown` de `github-actions`); corrigido, com checagem no
`ci-config.test.sh`.

Pendência:

- primeiro PR do Dependabot (`chore(deps): …`): quando vier, marcar a tarefa 3.7 e arquivar
  `bootstrap-repository-governance`. Os jobs rodam às segundas, às 06:00 de Brasília. O de
  2026-11-16 rodou sem erro, mas sem PR: todas as versões novas estavam dentro do cooldown de 7
  dias. O próximo é em 2026-11-23.

## F1: esqueleto, gates e spikes

Concluída em 2026-11-11, com a ADR 0003 `accepted` e as mudanças `scaffold-monorepo` e
`setup-quality-gates-ci` arquivadas. CI de PR em cerca de 4 min (5,8 min de mediana medidos em
2026-11-12, com o Stryker no caminho crítico); um segredo de teste reprova o `ci-gate`. OpenSSF
Best Practices `passing` desde 2026-11-11 (projeto 16550; análise dinâmica `Unmet` até o ZAP da F8,
release notes `N/A` até a v0.1.0).

Spikes (detalhes na ADR 0003):

- **(a) web na Netlify** e **(c) proxy Netlify → Vercel**: concluídos, e superados em 2026-11-12
  pela mesma origem na Vercel (ADR 0029).
- **(b) API na Vercel**: Build Output API montado do bundle do tsdown (ADR 0017), Function `index`
  em `gru1` com Node 24, SSE de 95 s sem corte, promote durante stream e `waitUntil` ok; a
  desconexão só é percebida com `supportsCancellation`, padrão com `maxDuration` de 120 s.
- **(d) pooler do Neon**: timeouts no role valem pelo pooler, que recusa `statement_timeout` como
  parâmetro de conexão; o resume cabe com folga.
- **(e)** e **(g)**: concluídos; bibliotecas ainda não introduzidas são conferidas pelas fases que
  as introduzem.
- **(f) ingestão**: Docling com TableFormer V1 `ACCURATE` (o V2 desmonta as tabelas de campos; Guia
  3.2.4 inteiro em 71,7 min, 457 tabelas); WS de Tabelas Externas em TXT cp1252 com SHA-1;
  `bge-m3` com `[n, 1024]` e custo real em `meta.neurons`; red team sem `hijacking`, com
  `jailbreak:tree` e `jailbreak-templates`. O token do Workers AI está no `tools/ingest/.env` local
  e no environment `staging` (`CF_AI_TOKEN`, `CF_ACCOUNT_ID`).

As rotas `/api/_spike/*` e a `TEKO_SPIKE_SENSITIVE` saíram do código; os workflows `spike-*.yml`
saem com a ADR 0032. As env vars Config da F1 do projeto de staging foram gravadas à mão (a F7
automatiza).

Riscos residuais (ADR 0003): SIGTERM e cold start não medidos com rigor; WAF na F7.

## F2: domínio de vigência, schema e busca híbrida

Concluída em 2026-11-11 (mudanças arquivadas `add-validity-domain`, `add-corpus-schema`,
`add-hybrid-search`; ADRs 0009 e 0010). Driver `pg` 8.23.1, exceção de proveniência no ADR 0002,
junto com Testcontainers, `yaml` e os overrides de `glob`/`basic-ftp` da árvore do promptfoo.

- Fixture única com textos reais: 1.574 chunks, vetores BGE-M3 reais em `embeddings.json.gz`
  (regenerar com `pnpm --filter @teko/api fixtures:embed` e as credenciais do
  `tools/ingest/.env`). Golden de 50 casos revisado pelo mantenedor em 2026-11-11.
- Retrieval evals: recall@10 0,925, MRR 0,771, demais 1,00; `sql-perf` em cerca de 120–135 ms.
- Roles do Neon criados em 2026-11-11 com `scripts/neon-roles.ts` (`teko_watch` no staging;
  `teko_app` e `teko_watch` na produção), com as URLs `-pooler` em `maintenance` e `corpus-watch`
  ([runbook](runbooks/neon-roles.md)). Nenhuma migração rodou ainda na produção (a primeira é do
  deploy da F7).

## F3: ingestão C1 e C2, embeddings e watch

Concluída em 2026-11-12. Código entregue em 2026-11-11 (#25); o primeiro run real no staging, em
2026-11-12, trouxe correções em PRs próprios (#26 a #46).

- Mudanças arquivadas: `add-rcte-cte-html-parser`, `add-go-code-tables-ingestion`,
  `add-embedding-pipeline`, `add-docling-pdf-extraction`, `add-sped-guides-ingestion`,
  `add-parser-revision`, `add-reranker`, `fix-hybrid-search-provision-dedup` e
  `add-http-pinned-guides`; em 2026-11-13, `add-source-change-monitoring`,
  `fix-safe-fetcher-retries` (#46), `fix-rcte-sem-efeitos-e-titulos-acrescidos` (revisão 2 do
  `go-html-state-machine`: notas "sem efeitos" da LC 194/2022 e títulos acrescidos como o
  "CAPÍTULO IV-A" da EFD) e `fix-rcte-nota-por-dispositivo` (revisão 3: a nota de alteração vai
  para o dispositivo que cita, como no art. 12, IV, do RCTE, e a triagem das `NotaVigncia` em
  revisão, com os primeiros overrides); o próximo run reprocessa o RCTE e o CTE.
- ADRs 0011, 0025 (reconciliação por janela, aceita pelo mantenedor em 2026-11-12), 0026, 0027 e
  0028 (exceção http com pin), todas accepted.
- Medido nos arquivos oficiais: 97,1% das `NotaVigncia` do RCTE e 96,6% das do CTE; com os
  overrides de `corpus/overrides/`, ficam em revisão 9 notas do RCTE e 1 do CTE
  ([triagem](evals/triagem-notas-pending-2026-11-13.md)).
- Desvios: staging migrado pelo `ingest load --migrate`; Guias de 2021 a 2024 do portal antigo em
  http com pin (ADR 0028); REINF pelo pacote de XSD.

**Staging em 2026-11-12** (corpus_version 10, run 43287466540): as 36 fontes das ondas C1 e C2
publicadas; Docling de 9 a 15 min por parte de 125 páginas (40 partes, 6 em paralelo); carga
completa em cerca de 5 mil neurons. `corpus-eval` verde pela primeira vez: recall@10 0,925, MRR
0,681 e demais 1,00, com o reranker do Workers AI (ADR 0027) e os limites próprios do corpus real
(`retrieval-corpus`, MRR ≥ 0,65; a meta de 0,70 é da F4).

**Guias de 2021 a 2024** (corpus_version 11): Guias 3.0.6, 3.0.8, 3.1.2, 3.1.3 e 3.1.6 do portal
antigo, em http com pin, e cobertura da EFD ICMS/IPI desde 2021-01-01. O staging foi de 265 MB
para 304 MB (673 neurons). `corpus-eval` verde (run 43332437880): recall@10 0,925, MRR 0,662 e
demais 1,00.

Lições do primeiro run, já no código:

- o `docling-models` baixa só `layout` e `tableformer` (o OCR vinha do ModelScope, bloqueado);
- correção de parser só chega a arquivo já ingerido com a revisão do parser incrementada
  (`PARSER_REVISIONS`, ADR 0026);
- `lock-pr` e `corpus-eval` rodam com o `extract` pulado (`!cancelled()` explícito), e o PR novo do
  lock fecha os anteriores;
- o `ci-gate` aceita `mutation` e `perf` pulados (PR que só muda `corpus/`).

**Source-watch** (2026-11-13): o cron `0 9 * * *` não disparou nesse dia (o GitHub descartou o
run agendado), e o run manual 43462349735 no `develop` foi verde: 0 mudança e 0 erro nas 9
páginas; `verified_at=2026-11-13` no staging pelo `teko_watch`, e a produção com o aviso esperado
de banco sem o schema `corpus` até a primeira promoção. O harden-runner dos três jobs passou para
`block`, com os hosts observados nesse run. O evento quando houver mudança chegou na F6: vai ao
PostHog (ADR 0037).

Sem pendências: a F3 está fechada.

## F4: API completa

Concluída em 2026-11-14 (PRs #85 a #95), com um desvio aprovado na meta de MRR (abaixo).
Começou em 2026-11-14, em PRs por mudança OpenSpec. Decisão do mantenedor no início da fase: a
cadeia de LLM usa o AI SDK da Vercel (`ai`, `@ai-sdk/google` e `@ai-sdk/groq`, todos com
proveniência) no lugar do `@google/genai` (sem proveniência em nenhuma versão) e do `groq-sdk`.

- `add-api-foundation` (arquivada em 2026-11-14): guarda de `Origin`, `content-type` e query
  string nas mutações, rate limit em Postgres entre instâncias, `GET /api/v1/coverage`, paleta,
  linha do tempo e diff de dispositivos, e `GET /api/v1/_eval/search` só com `APP_ENV=ci` (#85).
- `add-auth-oauth-passkey` (arquivada em 2026-11-14): Better Auth 1.7.18 com OAuth GitHub e Google,
  passkey, sessão por cookie, rate limit em banco, schema `auth` (FKs de `app` para `auth.user`),
  `GET /api/v1/me`, onboarding com `TERMS_VERSION` e `seed:dev-session`. A guarda de `Origin` passou
  a cobrir `/api/auth/*`.
- `add-ask-question-streaming` (arquivada em 2026-11-14; junta as mudanças previstas
  `add-ask-question-streaming`, `add-llm-provider-chain`, `add-quota-guards-and-cache` e a parte de PII
  de `add-privacy-guards`): cadeia de LLM pelo AI SDK (ADR 0007), política regional, prompt
  versionado, `POST /api/v1/questions` com `QuotaGuard` sob advisory lock, cache exato e kill switch,
  stream em UI Message Stream v1 com teto próprio e desconexão abortando o LLM, histórico, feedback,
  cota e `POST /api/v1/_eval/answer`. ADRs 0007 e 0019 escritas.
- `add-privacy-guards` (arquivada em 2026-11-14): `GET /api/v1/me/export`, `DELETE /api/v1/me` com
  cascata e cookies apagados, sessão do banco nas rotas de DSR e na pergunta, `cli maintenance purge`
  (retenção de 90 dias) e o registro de tratamento em [`privacy/ropa.md`](privacy/ropa.md). O
  agendamento semanal fica com o `weekly-maintenance` do `ops.yml` na F7.
- `add-ci-stack-e2e` (arquivada em 2026-11-14): stack descartável de CI em `infra/ci/` (Postgres,
  imagem candidata da API com os limites da Fluid e Caddy na mesma origem), `e2e.yml` com Playwright
  (Chromium e viewport mobile) e o job `e2e` no `ci-gate`. As jornadas de interface chegam com a F5.
- Melhora do MRR no corpus real (sem mudança de requisito, sem OpenSpec): o reranker e o prompt
  passaram a ver o contexto do dispositivo-pai (ADR 0027, adendo). `corpus-eval` (run 43601785029):
  MRR de 0,683 para 0,714 no dev e de 0,475 para **0,654** no holdout. Outras três variantes foram
  medidas e revertidas ([registro](evals/mrr-f4-2026-11-14.md)). ADRs 0006 e 0008 escritas.
- `add-query-rewriting` (arquivada em 2026-11-14): reescrita da pergunta pelo LLM antes da busca
  (ADR 0034), desligada por padrão (`QUERY_REWRITE_ENABLED`); o `corpus-eval` a liga quando o
  environment `staging` tem as chaves do LLM e grava a consulta de cada caso no relatório.

- **Meta de MRR (desvio aprovado em 2026-11-14):** o holdout ficou em 0,654 sem reescrita e 0,668 com
  a reescrita só no braço léxico, desligada (dev 0,718, sem regressão); a meta era 0,70. O mantenedor
  aceitou o nível medido. Os 13 casos do holdout que orientaram os ajustes foram para o conjunto
  `ajuste`, e o holdout recebeu 13 casos novos (ADR 0031, adendo).

Cota gratuita da cadeia de LLM (medida em 2026-11-14, resolvida em 2026-11-15): o Flash Lite passou
a primário, com o Flash de reserva, e o breaker do 429 distingue a cota diária do limite por minuto
(ADR 0007, adendo).

O que o deploy exige do mantenedor está em [Antes da F7](#antes-da-f7-o-que-o-mantenedor-faz).

## F5: frontend completo

Concluída em 2026-11-15 (PRs #100 a #108), em três ondas de agentes em paralelo: fundação (dados,
shell e build), telas (chat, histórico, autenticação, legais e consentimento) e fechamento
(cobertura, painel de citação, axe e prova do DoD). O DoD está provado item por item no
[registro](evals/dod-f5-2026-11-15.md), e as decisões que valem para as próximas fases estão na
[ADR 0035](adr/0035-front-da-f5.md).

- `add-web-data-layer` (arquivada em 2026-11-15): OpenAPI versionado em `apps/web/openapi.json` (exportado pela CLI da API,
  sem servidor nem banco), cliente `@hey-api/openapi-ts` com gate de drift (`pnpm api:check`, no
  `verify` e no job `lint`), TanStack Query, `ApiError` a partir de Problem Details, parsers do nuqs
  (`q`, `c`, `ref`) e hooks de leitura. O item "cliente gerado sem drift" do DoD fica coberto pelo
  gate.
- `add-web-shell-and-design-system` (arquivada em 2026-11-15): componentes do shadcn sobre Base UI
  copiados do registry, tokens OKLCH novos no teste de contraste, seletor de tema, Geist Mono, app
  shell no grupo `(app)` com paleta `Ctrl/⌘+K` e aviso fixo, área de trabalho do chat em três
  painéis (Sheet e Drawer abaixo de 768 px), páginas-esqueleto nos dois locales e a landing revista.
- `add-web-build-security` (arquivada em 2026-11-15): guard de estático puro no build, CSP por
  documento com hash dos inline (Vercel, Plano B e Caddy da stack de CI), redirect da raiz por
  `Accept-Language` e 404 por locale, orçamento de bundle total e o e2e `platform.spec.ts`. Na
  integração, o Zod passou a rodar sem JIT no navegador (`instrumentation-client.ts`), porque o
  teste de `new Function` dele violava a CSP.
- `add-history-and-provisions` (arquivada em 2026-11-15): `GET /api/v1/conversations` (cursor com
  microssegundos), histórico no painel do chat e em `/history/`, página de dispositivo com badge de
  vigência, linha do tempo e "O que mudou" sob demanda, busca de dispositivos, comparação entre
  datas (RCTE, art. 76, § 6º, 05/2008 contra 01/2010) e o e2e `history.spec.ts`.
- `add-i18n-en-ptbr` (arquivada em 2026-11-15): `/privacy`, `/terms` e `/about` com texto real nos
  dois idiomas (revisados pelo mantenedor em 2026-11-16, lista no PR), `TERMS_VERSION` em
  `@teko/shared/legal`, banner LGPD com preferências e adapter de analytics no-op (o `posthog-js`
  fica para a F6), paridade com diff, helper de datas e e2e de consentimento e páginas legais. O item
  "zero cookies e zero chaves do PostHog antes do consentimento" do DoD fica coberto pelo e2e.
- `add-auth-ui` (arquivada em 2026-11-15): entrada com GitHub, Google e passkey (retorno só da
  própria origem, erros do callback e aviso de `region_restricted`), sessão no cabeçalho e na
  paleta, guarda do grupo `(app)`, onboarding bloqueante (e novo aceite a cada versão dos Termos),
  configurações (conta, cota, passkeys, exportação, exclusão, tema, idioma e densidade) e o e2e
  `auth.spec.ts`; sem o cliente do Better Auth no web. Bundle de primeiro acesso em 354,0 KiB gz (as
  configurações saem dele por `import()`).
- `add-chat-experience` (arquivada em 2026-11-15): `TekoChatTransport` same-origin com `useChat`,
  thread e composer acessíveis, Streamdown com `rehype-harden`, chips e painel de citação, data de
  referência na URL, cobertura, degradação, cota, PII e `fetch(` só em `src/lib/api`; o chat carrega
  sob demanda (first-load de 327,3 para 343,5 KiB gz) e o e2e `chat.spec.ts` cobre o 05/2008 → 01/2010.
- `add-coverage-page` (arquivada em 2026-11-15): `/coverage/` pública com fontes, períodos, lacunas e
  última verificação por família, linha do tempo e "O que mudou" (diff no clique) no painel de
  citação, um helper de datas só (`lib/i18n/format.ts`) e o e2e `coverage.spec.ts`; first-load de
  402,6 para 416,4 KiB gz.
- `add-web-a11y-gate` (arquivada em 2026-11-15): axe WCAG 2.2 AA no e2e (`a11y.spec.ts`, 112 testes:
  14 telas em en/pt-BR, claro/escuro, desktop/mobile), correções do nome acessível do botão da conta
  e do `h1` do chat, e a [prova do DoD da F5](evals/dod-f5-2026-11-15.md) item por item (sete
  jornadas, bundle em 416,4 KiB gz).
- `redesign-brand-and-shell` (redesign, onda 1, arquivada em 2026-11-16): paleta da logo nos tokens,
  `TekoLogo`, ícones e Open Graph, cabeçalhos e rodapé novos, menu de idioma com a query, raiz sem
  tela de idioma, app só com a sessão pronta e fim do "em construção"; bundle em 433,9 KiB gz.
- `redesign-landing` (redesign, onda 2, arquivada em 2026-11-16): landing com hero novo, linha do
  tempo do RCTE, art. 76, § 6º, demonstração animada do chat (05/2008 contra 01/2010, pausa,
  movimento reduzido, animador fora do primeiro acesso), seções com layouts próprios e páginas
  públicas em tipografia editorial; bundle de 434,4 para 440,5 KiB gz.

- **Orçamento de bundle (desvio aprovado em 2026-11-15):** o teto provisório de 400 KiB gz da onda 1
  não comportava as telas da F5 juntas; o mantenedor subiu o orçamento total para 500 KiB gz. A
  medição no fechamento é de 416,4 KiB gz.

Os textos de `/privacy` e `/terms` (a lista de pontos do PR #103) foram revisados pelo mantenedor
em 2026-11-16, sem mudanças. A F6 atualiza a política quando ligar o PostHog.

## Depois da F5

- `add-email-password-login` (arquivada em 2026-11-16, [ADR 0036](adr/0036-login-por-email-e-senha.md)):
  login por e-mail e senha em todos os ambientes, sem confirmação de e-mail nem recuperação de senha
  (decisão do mantenedor), sem vínculo implícito com GitHub ou Google, rate limit mais rígido nas
  rotas de e-mail, `GET /api/v1/auth/providers`, cliente no web (`signUpWithEmail`,
  `signInWithEmail`, `useAuthProviders`) e Termos e política na versão 2026-11-16. A tela de entrada
  com o formulário vem com o redesign do front.
- `redesign-auth-ui` (redesign, onda 2, arquivada em 2026-11-16): entrada em duas colunas com o
  painel da marca, só os métodos do ambiente (GitHub e Google com os símbolos, passkey e e-mail e
  senha em abas, com validação inline e o aviso sem recuperação), onboarding em passos com o país
  com busca, configurações com navegação lateral, método de entrada e zona de perigo; jornada local
  de cadastro, onboarding e chat pela tela; bundle em 441,9 KiB gz.
- `add-conversation-deletion` (arquivada em 2026-11-16, pedido do mantenedor):
  `DELETE /api/v1/conversations/:id` (só o dono; o mesmo 404 para a de outro; 409 `stream_busy` com
  resposta em andamento; uso do dia e cache intactos, então a cota não volta), menu "⋯" com
  "Excluir conversa" no painel do chat e em `/history`, confirmação em `AlertDialog` e aviso
  `aria-live`; política e Termos (mesma versão 2026-11-16) citam a exclusão de uma conversa.
- `simplify-chat-screen` (arquivada em 2026-11-16, pedido do mantenedor): chat em duas colunas no
  máximo, com o painel de citação só aberto (`Esc` fecha) e o histórico recolhível; a data só no
  chip do composer; quatro sugestões em linhas finas; uma linha de metadados na resposta, fontes
  recolhidas, aviso de parecer abaixo do composer e preferências de cookies no menu da conta. A
  conversa aberta pelo histórico volta na data dela.
- `trim-chat-texts` (arquivada em 2026-11-16, pedido do mantenedor): saem a frase do histórico
  vazio, o aviso de cota no diálogo de exclusão e o "(padrão: mês anterior)" do chip da data.
- PR #114 juntou o redesign (identidade, landing, telas do app, entrada, exclusão e chat limpo),
  com o bundle em 455,5 KiB gz e a suíte e2e completa verde. O Sonar passou a tratar
  `apps/web/e2e` como teste e a cobertura do web segue o `vitest.config.ts`. O `dev` da API usa
  `scripts/dev-watch.ts`, que só reinicia quando o código muda (no Windows, o `node --watch`
  reiniciava a cada leitura de arquivo).

## F6: observabilidade

Concluída em 2026-11-17 (PRs #116 a #121), em duas ondas de agentes em paralelo: analytics,
Grafana as code e telemetria; depois Langfuse e erros. O DoD está provado item por item no
[registro](evals/dod-f6-2026-11-17.md), e as decisões do OTel estão na
[ADR 0013](adr/0013-otel-2x.md); as do Langfuse, na [0012](adr/0012-langfuse-cloud.md); as dos
erros, na [0037](adr/0037-erros-no-posthog-error-tracking.md).

- `add-product-analytics` (arquivada em 2026-11-16, #116): `posthog-js` por `import()` só depois do
  consentimento, na UE, sem cookie, pageview nem autocapture; só os eventos do catálogo saem, sem o
  texto da pergunta e sem query nas URLs. `/privacy` reescrita para a F6 inteira, com a
  `PRIVACY_POLICY_VERSION` em 2026-11-17 (pede a escolha de novo).
- `add-uptime-monitoring` (arquivada em 2026-11-16, #117 e #118): `infra/grafana/` com cinco
  dashboards, os 16 alertas por e-mail e três checks do Synthetic Monitoring, aplicados por
  `scripts/grafana-apply.ts`; `ops.yml` com os jobs `grafana`, `coverage-age` e `quotas`; runbooks
  `provider-outage`, `quota-exhausted`, `neon-suspended`, `quotas` e `ops-alerts`.
- `add-otel-telemetry` (arquivada em 2026-11-16, #119): SDK do OTel 2.x com OTLP direto ao Grafana
  Cloud, flush por requisição em `BackgroundTasks`, `TekoSampler` sem o `/healthz`, `x-trace-id` em
  toda resposta, `traceparent` do web e "ID de suporte" nos erros.
- `add-llm-tracing-langfuse` (arquivada em 2026-11-17, #120): `LangfuseSpanProcessor` no mesmo
  provider, `TraceSampler` pelo hash da pergunta (produção 1,0 até 35k units projetadas e 0,2 depois,
  staging 0,1, CI 0), trace `rag-query` com custo por consulta, score `user_feedback` e annotation
  queue do 👎, apagamento dos traces com a conta e o job `langfuse` do `ops.yml`.
- `add-error-tracking` (arquivada em 2026-11-17, #121): erros inesperados da API e do navegador no
  PostHog Error Tracking, sem PII e com o `trace_id`; `posthog-cli` isolado em `tools/posthog-cli`
  com o binário conferido por sha256; relatório de CSP e de Trusted Types; evento do `source-watch`.

- **Temporalidade das métricas (decisão do mantenedor em 2026-11-16):** cumulativa, no lugar do
  delta do desenho, porque o Mimir recusa delta sem a ingestão nativa experimental (ADR 0013).
- **Desvios registrados nas ADRs:** os spans `chat <modelo>` ficam só no Grafana; o
  `@langfuse/client` fica de fora (o `mustache` dele não tem proveniência); o `inject` dos source
  maps não roda no `pnpm build` (exige o binário), então o Plano B fica sem inject; o `posthog-cli`
  manda telemetria própria aos EUA no upload; robôs (o Synthetic Monitoring e o Chromium headless)
  não geram `$exception`.

Pendências, todas da F7 (conferência no staging, roteiro em
[O que a F7 confere](evals/dod-f6-2026-11-17.md#o-que-a-f7-confere-no-staging)):

- mesmo `trace_id` no Grafana Cloud, no Langfuse Cloud e no PostHog numa pergunta real;
- 100 perguntas no staging gerando 100 traces completos;
- `/healthz` sem aumento de CU-h em 24 h;
- projeção do Langfuse abaixo de 35k units;
- stack de um erro de teste resolvida pelos source maps do upload do deploy;
- `grafana-apply` sem `--dry-run` na stack real.

A política de privacidade da versão 2026-11-17 (#116, lista de parágrafos no PR) foi revisada pelo
mantenedor em 2026-11-17, sem mudanças.

## Antes da F7: o que o mantenedor faz

Lista única das ações fora do repositório que o deploy da F7 exige. O agente que começa a F7
apresenta esta lista ao mantenedor, confere o que já foi feito (nomes de segredos com
`gh secret list --env <env>`; env vars da Vercel com `vercel env ls`, sem ler valores) e marca cada
item aqui. Segredos nunca passam pelo chat: o mantenedor grava cada um.

- [ ] **OAuth apps** do GitHub e do Google, uma de staging e uma de produção, com callback em
  `<WEB_ORIGIN>/api/auth/callback/{github,google}`.
- [ ] **Env vars Sensitive da autenticação** nos dois projetos da Vercel: `BETTER_AUTH_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
- [ ] **Chaves de LLM** (Sensitive) nos dois projetos da Vercel: `GEMINI_API_KEY` e `GROQ_API_KEY`.
  As chaves do Gemini do staging e da produção vêm de projetos diferentes do Google Cloud, porque a
  cota é por projeto (ADR 0007, adendo de 2026-11-15); o ZDR fica ligado no console do Groq. O
  environment `staging` do GitHub já tem as duas chaves (usadas pelo `corpus-eval`).
- [ ] **Banco e Workers AI** (Sensitive) nos dois projetos da Vercel: `DATABASE_URL` (URL `-pooler`
  do role `teko_app` do projeto Neon do ambiente), `CF_ACCOUNT_ID` e `CF_AI_TOKEN` (token só de
  inferência). Os manifestos `infra/vercel/env.*.json` exigem os três desde a F2; em 2026-11-17,
  os dois projetos só tinham a `POSTHOG_PROJECT_KEY` entre as Sensitive.
- [ ] **Environment `production` do GitHub**, hoje sem segredo nem variável: `VERCEL_TOKEN` próprio,
  `VERCEL_AUTOMATION_BYPASS_SECRET` do `tekoia`, as vars `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` e
  `NEON_PROD_MIGRATE_URL` (tabela de environments em
  [`ci-cd-e-ambientes.md`](architecture/ci-cd-e-ambientes.md)).
- [ ] **Passkey do system test** no environment `staging` (mesma tabela).
- [ ] **Checklist dos projetos e do time da Vercel** em
  [`infra/vercel/README.md`](../infra/vercel/README.md) (Build and Deployment, Deployment
  Protection, Firewall e "Time e conta"): conferir no dashboard e marcar lá.
- [ ] **Grafana Cloud Free** com uma stack numa região da UE e o environment `ops` do GitHub (só
  `main`), com os segredos `GRAFANA_SA_TOKEN`, `GRAFANA_SM_TOKEN`, `GRAFANA_OTLP_TOKEN`,
  `GRAFANA_ALERT_EMAILS`, `NEON_API_KEY_PROD` e `NEON_API_KEY_STAGING` e as variáveis `GRAFANA_URL`,
  `GRAFANA_SM_URL`, `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_INSTANCE_ID`, `NEON_PROD_PROJECT_ID`,
  `NEON_STAGING_PROJECT_ID`, `TOKEN_EXPIRY_DATES` e, opcional, `GRAFANA_PROM_DATASOURCE_UID`
  ([`infra/grafana/README.md`](../infra/grafana/README.md)).
- [ ] **OTLP da API** (Sensitive) nos dois projetos da Vercel: `OTEL_EXPORTER_OTLP_ENDPOINT` e
  `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Basic%20<base64 de instância:token>`).
- [ ] **Langfuse Cloud EU (Hobby)** com a organização e os projetos `teko-prod` e `teko-staging`:
  `LANGFUSE_PUBLIC_KEY` e `LANGFUSE_SECRET_KEY` (a secreta Sensitive) em cada projeto da Vercel, com
  as chaves do projeto correspondente, e as de produção no Render; no environment `ops`, os segredos
  `LANGFUSE_PROD_PUBLIC_KEY`, `LANGFUSE_PROD_SECRET_KEY`, `LANGFUSE_STAGING_PUBLIC_KEY` e
  `LANGFUSE_STAGING_SECRET_KEY` e, opcional, a variável `LANGFUSE_BASE_URL`.
- [x] **PostHog EU** (feito em 2026-11-17), um projeto só, o 355097 "Tekó":
  - **Projeto:** cookieless, "Discard client IP data" e Error Tracking ligados; replay, autocapture,
    heatmaps, dead clicks, console log e performance desligados. Há um dashboard, "Tekó: uso e
    qualidade", com seis insights sobre o catálogo de eventos.
  - **Chave do projeto (`phc_`, pública):** `POSTHOG_PROJECT_KEY` (Sensitive) nos dois projetos da
    Vercel; variável `POSTHOG_PROJECT_KEY` do environment `staging` (evento do `source-watch`).
  - **Build do web:** variáveis `NEXT_PUBLIC_POSTHOG_ERRORS_KEY` (environments `staging` e
    `production`) e `NEXT_PUBLIC_POSTHOG_KEY` (só `production`). Precisam estar no GitHub, e não na
    Vercel: o build roda no Actions, sem `vercel pull` (ADR 0017). O pipeline da F7 as passa ao passo
    de build e define `NEXT_PUBLIC_TEKO_RELEASE`.
  - **Source maps:** segredo `POSTHOG_CLI_API_KEY` (chave pessoal `phx_` com `error tracking write`
    e `organization read`) e variável `POSTHOG_CLI_PROJECT_ID` nos environments `staging` e
    `production`.
  - **Plano B (decisão do mantenedor em 2026-11-17):** sem `POSTHOG_PROJECT_KEY` no Render; os erros
    da API do Plano B ficam só no log e nos traces.
  - Não há chave pessoal no runtime: o analytics não se liga à conta, então não há o que apagar no
    PostHog com a exclusão dela.

## Revisão antes da F4 (2026-11-12)

O mantenedor aprovou as recomendações da revisão de arquitetura; os pacotes estão no
[roteiro](roadmap.md#revisão-antes-da-f4-2026-11-12). O plano de 2026-11-10 foi congelado: a fonte
de verdade passou a ser este diretório (ADR 0001, adendo de 2026-11-12).

Concluída em 2026-11-13 (PRs #61 a #77), sem pendências:

- PRs dos pacotes A, B, B2, C, D e E entraram. Os artefatos da ingestão foram migrados do Netlify
  Blobs para o GitHub Releases em 2026-11-13 (run 43355872236 do `blobs-migrate.yml`: 150 itens,
  59 raw, 55 Docling, 33 de snapshot e 3 do watch, sem falha; o dry-run seguinte deu 150 iguais) e
  a etapa C2 tirou o Netlify Blobs do código e dos workflows (ADR 0030);
- contas e tokens que saíram, feito em 2026-11-13: site `tekoia` apagado e PAT da Netlify
  revogado; `NETLIFY_AUTH_TOKEN` e `NETLIFY_SITE_ID` fora do environment `staging`; App do Codecov
  desinstalado; WAF aplicado e env vars ajustadas nos dois projetos da Vercel;
- trunk-based (ADR 0033): concluído em 2026-11-13, inclusive o branch principal `main` no
  SonarQube Cloud;
- revisão do mantenedor dos casos do golden `holdout`: feita em 2026-11-13 (#74).
