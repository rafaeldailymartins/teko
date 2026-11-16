# Design

## Context

A F5 entregou o banner LGPD, a escolha versionada em `localStorage['teko-consent']` e o adapter de
`src/lib/analytics/`, com um carregador no-op (ADR 0035, item 5). Esta mudança troca o no-op pelo
`posthog-js`, emite o catálogo tipado de `@teko/shared/analytics` e reescreve a política de
privacidade para a F6 inteira. Em paralelo, `add-otel-telemetry` mexe no cliente de API do web
(`traceparent`, "ID de suporte") e `add-uptime-monitoring` no Grafana; depois vem
`add-error-tracking`, que reaproveita este cliente para o PostHog Error Tracking.

Documentação consultada pelo Context7: `/posthog/posthog-js` (entradas `module.no-external` e
`module.slim.no-external`, `ConsentManager` com `cookieless_mode: 'on_reject'`, `set_config`,
`opt_in_capturing` e `opt_out_capturing`, `before_send`, `extension-bundles`), `/websites/posthog`
(importar `posthog-js/dist/surveys` com `no-external`, retenção de eventos por plano),
`/vercel/next.js` (`useReportWebVitals` no App Router), `/langfuse/langfuse-docs` (acesso de 30 dias
no Hobby e retenção configurável só no Pro) e `/websites/grafana_grafana-cloud` (14 dias de
retenção no Free). O resto veio da leitura do próprio pacote em `node_modules` (tipos de
`@posthog/types` e o código do `RequestRouter`, do `opt_out_capturing` e da limpeza de storage
das pesquisas).

## Decisions

- **`posthog-js` 1.447.3, entrada `dist/module.no-external` + `dist/surveys`.** É a forma
  documentada de não carregar script externo e ainda ter as pesquisas no bundle (a arquitetura pede
  "surveys no bundle"). A `module.slim.no-external` com `extension-bundles` traria um arquivo de
  extensões de 222 KB sem ganho real. 1.448+ tinha menos de 7 dias. Licença `Apache-2.0 AND MIT`,
  proveniência SLSA conferida com `npm view posthog-js@1.447.3 dist.attestations`; o build script
  do `core-js` (só um pedido de doação) fica recusado em `allowBuilds`.
- **Fora do first-load.** O `client-loader.ts` faz `import('./posthog-client.ts')`; o SDK, o
  catálogo com o Zod e as pesquisas ficam num chunk de 166,1 KiB gz que só baixa depois do aceite e
  com a chave no build. O first-load do export ficou em 461,1 KiB gz (teto de 500).
- **Configuração.** Host da UE; `disable_external_dependency_loading`; `cookieless_mode:
  'on_reject'` (depois de um opt-out o SDK troca a identidade e não grava mais nada);
  `persistence: 'localStorage'` (sem cookie nenhum); `person_profiles: 'identified_only'` e nenhum
  `identify`: a arquitetura não pede, a medição não se liga à conta e a exclusão da conta não tem
  o que apagar no PostHog do lado do navegador; `defaults: '2026-08-30'` com
  `internal_or_test_user_hostname: null` (senão `localhost` ligaria perfil de pessoa);
  `save_campaign_params: false` e `mask_personal_data_properties: true`.
- **Só o catálogo sai.** Autocapture desligado (o texto de um botão ou de um item do histórico pode
  ser a pergunta), assim como pageview, pageleave, heatmaps, dead clicks, web vitals do SDK, replay,
  exceções, experimentos, tours e chat. O pageview não está no catálogo da arquitetura e levaria a
  query com `c` e `q`; o funil sai dos eventos do catálogo. Duas barreiras: o cliente valida cada
  `capture` com `parseAnalyticsProperties` (schema estrito, propriedade a mais descarta o evento), e
  o `before_send` descarta o que não é do catálogo nem das pesquisas (`survey shown`, `survey sent`,
  `survey dismissed`) e tira query e âncora de toda URL das propriedades, inclusive em `$set` e
  `$set_once`.
- **Consentimento.** Com o aceite: `init` uma vez por página e `opt_in_capturing({
  captureEventName: false })` (o aceite já vai como `consent_updated`). Retirar: `opt_out_capturing`,
  pesquisas desligadas, `before_send` cortando tudo e limpeza das chaves do PostHog no `localStorage`,
  no `sessionStorage` e nos cookies (`ph_*`, `__ph_*`, `*posthog*`, `seenSurvey_*`,
  `inProgressSurvey_*`, `abandonedSurvey_*`, `lastSeenSurveyDate`). Um novo aceite na mesma página
  reaproveita a instância e refaz o opt-in, que sai do modo cookieless com identidade nova. Recusar
  na primeira visita nem baixa o SDK: o `cookieless_mode` só vale para quem retira o consentimento
  com a página aberta.
- **Pesquisas.** `disable_surveys` acompanha a categoria `surveys` por `set_config` (o SDK lê a
  flag a cada uso).
- **Eventos no web.** `question_asked` (envio, esclarecimento e "tentar de novo", com a origem da
  data, nunca o texto), `reference_date_set` (chip e confirmação da data inferida),
  `clarification_shown`, `answer_completed`, `answer_refused` e `provider_fallback` (no `onFinish`
  do `useChat`, a partir de `data-meta`, `data-refusal`, `data-clarification` e dos metadados do
  `finish`; `trace_id` só quando é W3C de 32 hex; família do modelo sem versão; resposta do cache usa
  o provedor), `quota_reached` (escopo do `ApiError`), `citation_opened` (família e
  `isCurrent`), `diff_opened` (cada `ProvisionDiff` montado: painel, página do dispositivo e
  comparação), `answer_feedback`, `locale_changed` (clique no menu de idioma), `consent_updated` (já
  existia) e `web_vital`. O mapeamento puro fica em `src/lib/analytics/chat-events.ts` e
  `web-vitals.ts`, testado contra o schema do catálogo.
- **Web Vitals pelo Next.** `useReportWebVitals` num componente carregado por `next/dynamic` só
  quando o adapter informa `loaded`: sem consentimento nem o código do `web-vitals` baixa (3,8 KiB
  gz). Os observers usam `buffered`, então TTFB, FCP e LCP já ocorridos também chegam. Não entra o
  `web-vitals` como dependência direta: o pacote não publica proveniência.
- **CSP com o host de assets da UE.** Com `disable_external_dependency_loading`, o SDK não baixa
  script, mas lê a configuração remota do projeto por `fetch` em
  `https://eu-assets.i.posthog.com/array/<chave>/config` (`RequestRouter.endpointFor('assets')`).
  Sem ela, pesquisas e flags não ligam. `connect-src` passa a ter os dois hosts, de
  `src/lib/analytics/posthog-hosts.ts`, que o pós-build importa (uma fonte só para a CSP, o cliente
  e o e2e). `report-to` continua de fora (é da `add-error-tracking`).
- **Política de privacidade da F6 inteira.** Para não pedir dois aceites seguidos, `/privacy` já
  descreve o PostHog para produto (consentimento, art. 7º, I) e para erros, o Langfuse e o Grafana
  Cloud (legítimo interesse, art. 7º, IX), com as retenções da documentação oficial: PostHog Free 1
  ano de eventos; Langfuse Hobby com acesso de 30 dias e sem apagamento automático; Grafana Cloud
  Free 14 dias. `PRIVACY_POLICY_VERSION` vai de `2026-11-16` para `2026-11-17` (a data de hoje já era
  a versão vigente). Os Termos não mudam.
- **E2E com chave fictícia.** `infra/ci/up.sh` builda o web com
  `NEXT_PUBLIC_POSTHOG_KEY=phc_teko_ci_e2e_ficticia`. As jornadas começam com a medição recusada e
  não carregam o SDK; o `consent.spec.ts` intercepta todo host `*.posthog.com` (UE responde vazio com
  CORS, qualquer outro é abortado) e prova que antes do aceite não há pedido, que depois só a UE é
  chamada e sem cookie, e que retirar o consentimento apaga as chaves.

## Para a `add-error-tracking`

O cliente é o singleton de `posthog-js/dist/module.no-external`, inicializado em
`src/lib/analytics/posthog-client.ts` (`loadPosthogClient`). Para capturar exceções: importar
`posthog-js/dist/exception-autocapture` ali, ligar `capture_exceptions` em `posthogConfig`
(`posthog-config.ts`), liberar `$exception` em `SDK_EVENTS` e pôr o `trace_id` nas propriedades. A
política já diz que erros e telemetria técnica não gravam nada no navegador: captura sem
consentimento de analytics precisa de outra instância sem persistência (`persistence: 'memory'` ou
`cookieless_mode: 'always'`).

## Risks / Trade-offs

- **Estilos das pesquisas e a CSP.** O renderizador das pesquisas injeta um `<style>` no shadow DOM;
  a CSP do documento (`style-src-elem 'self' 'sha256-…'`) o bloqueia, e a pesquisa aparece sem
  estilo. Nenhuma pesquisa existe hoje; ao criar a primeira, decidir entre um hash do CSS do SDK no
  pós-build ou o `prepare_external_dependency_stylesheet`.
- **IP no PostHog.** O endereço IP chega ao PostHog com cada envio; a política diz que o projeto o
  descarta, o que depende de ligar "Discard client IP data" nas configurações do projeto.
- **Langfuse sem apagamento automático.** No Hobby os traces ficam até alguém apagar; a política
  promete o apagamento com a exclusão da conta, que é da `add-llm-tracing-langfuse`.
- **Região do Grafana Cloud.** A política e o `ropa.md` dizem UE; a stack precisa ser criada numa
  região da UE.
