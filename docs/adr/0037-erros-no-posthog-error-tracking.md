---

status: accepted
date: 2026-11-17
decision-makers: Rafael Daily Santos Martins
---

# 0037 — Erros no PostHog Error Tracking, com source maps e relatório de CSP

## Contexto e problema

O roteiro da F6 deixou o destino de erros em aberto: o PostHog Error Tracking, se cobrisse o que o
Sentry cobriria (source maps enviados no deploy, agrupamento por release e destino para os
relatórios de CSP e de Trusted Types); senão, o Sentry (organização EU, só erros, projeto separado
para CSP). A conta do PostHog (UE) já existe para o analytics de produto (#116), o texto publicado da
política de privacidade já declara o PostHog Error Tracking como destino dos erros, e o custo zero
pede o menor número de contas. Faltava confirmar pela documentação oficial e decidir como fazer
caber a captura no navegador, os source maps e o relatório de CSP nas restrições do Tekó.

## Fatores de decisão

- Custo zero e o menor número de contas e segredos (ADR 0004 e [contas e cotas](../architecture/contas-e-cotas.md)).
- Dados na UE e a política publicada: erros e telemetria técnica são legítimo interesse e não gravam
  nada no navegador; não dependem do consentimento de analytics.
- Pilha resolvida pelos source maps, os mesmos `trace_id` do Grafana e do Langfuse, e os relatórios
  de CSP e de Trusted Types (este em report-only até o enforce da F10).
- Orçamento de 500 KiB gz do primeiro acesso (ADR 0035) e a política de supply chain (ADR 0002).

## Opções consideradas

1. **PostHog Error Tracking** (o mesmo projeto do analytics, plano Free: 100 mil exceções por mês).
2. **Sentry** (Developer, EU), só para erros e CSP.
3. **Só logs e traces no Grafana Cloud**, sem destino de erros.

## Decisão

Opção 1. A documentação oficial (Context7 `/posthog/posthog.com`) cobre os três pontos: upload de
source maps pelo `posthog-cli` (`sourcemap inject` e `sourcemap upload`, com release),
relatório de CSP pelo endpoint `/report/?token=<chave>` (`report-uri`, `report-to` e o header
`Reporting-Endpoints`, inclusive em `Content-Security-Policy-Report-Only`) e `captureException` no
`posthog-node` e no `posthog-js`.

1. **API.** A porta `ErrorReporterPort` (`application/ports`) com o adapter do `posthog-node`
   (`adapters/out/error-reporting`) recebe, do `setErrorHandler`, só os erros inesperados (`internal`,
   500); os 4xx esperados e os 503 deliberados (`service_paused`, `upstream_unavailable`) têm métricas
   próprias. O erro sai por uma cópia passada pelo scrubber (o `PiiRedactor` de `@teko/shared/pii`,
   credenciais de URL, mensagem cortada, sem `cause`), sem as linhas de código-fonte que o SDK lê do
   disco, com `trace_id`, método, rota declarada, status, ambiente e o release (`teko@X.Y.Z` na
   produção, `teko@<sha7>` nos demais). O `distinct_id` é o `trace_id` da requisição: técnico,
   aleatório e sem perfil (`$process_person_profile: false`, sem GeoIP). O envio é imediato e o
   flush vai para `BackgroundTasks` (500 ms) só quando houve erro. Host fixo no código (UE); sem
   `POSTHOG_PROJECT_KEY`, no-op.
2. **Navegador.** Um handler mínimo de `error` e `unhandledrejection` no `instrumentation-client.ts`
   (mais os `ErrorBoundary` e as consultas que falham com 500) e o `posthog-js` por `import()` só no
   primeiro erro: o `captureException` recebe o erro já ocorrido, com a própria pilha. É uma
   instância nomeada do mesmo `module.no-external` do analytics, com `persistence: 'memory'`,
   `disable_persistence`, `person_profiles: 'never'`, sem `identify`, pageview, autocapture nem
   flags, e um `before_send` que só deixa sair `$exception` (sem PII, sem query nas URLs). Não depende
   do consentimento; `NEXT_PUBLIC_POSTHOG_ERRORS_KEY` no build liga, e o release vem de
   `NEXT_PUBLIC_TEKO_RELEASE`.
3. **Source maps.** O web passa a gerar `.map` (`productionBrowserSourceMaps`) e a API já gerava.
   O `posthog-cli` fica isolado em `tools/posthog-cli` (lockfile e auditoria próprios, como o
   `tools/vercel-cli`), com o `postinstall` desligado: o pacote do npm é um instalador do cargo-dist
   que baixaria o binário sem checksum, e o `install-binary.mjs` baixa o mesmo artefato do GitHub
   Releases do PostHog e confere o sha256 fixado. O `inject` (`scripts/sourcemaps.ts`) é offline por
   construção (veja abaixo) e roda na stack de CI e no deploy; o `upload` precisa da chave pessoal e
   fica pronto na composite `.github/actions/posthog-sourcemaps` para o pipeline da F7. Os `.map`
   nunca são servidos: o `build-vercel-output` não os copia para o `static/`, o Plano B responde 404 e
   o Caddy da stack de CI também.
4. **CSP.** Com a chave dos erros no build, a CSP e o Trusted Types report-only de cada documento
   ganham `report-uri <host UE>/report/?token=<chave>` e `report-to posthog`, e o documento ganha o
   `Reporting-Endpoints`. Uma violação de `require-trusted-types-for` é um relatório de CSP como
   outro (`effective-directive`), então vai ao mesmo endpoint; a documentação do PostHog não cita o
   Trusted Types à parte, e o staging confirma antes do enforce. Sem a chave, a CSP fica igual.
5. **`source-watch`.** Com mudança nas fontes, o job manda um evento `source_watch_changed` à API de
   captura (chave do projeto no environment `staging`); sem a chave, aviso e saída 0.

### O `inject` é offline só sob condições

O `posthog-cli` 0.19 exige uma credencial até para o `inject` e, quando acha um release (pelas
flags, pelo git do diretório de trabalho ou pelo CI), chama a API do PostHog para resolvê-lo. Sem
release, injeta só os chunk ids, que são determinísticos (pelo conteúdo). O `scripts/sourcemaps.ts`
roda o `inject` num diretório temporário fora do repositório, com um ambiente mínimo (sem
`GITHUB_*`), uma credencial de mentira e um proxy inalcançável: uma tentativa de rede falharia em vez
de sair. O release dos erros vai como propriedade (`release`) de cada exceção, e o `upload` associa
os source maps a `teko@<versão>`. O snippet injetado no topo de cada chunk só registra o chunk id
num objeto global; o e2e roda sobre o export injetado.

## Consequências

- Uma conta a menos (o Sentry sai de [contas e cotas](../architecture/contas-e-cotas.md)); staging e
  produção dividem o único projeto do plano Free, separados pelo release e pelo `app_env`.
- Segredos novos: `POSTHOG_PROJECT_KEY` (Sensitive na Vercel e no Render), a chave pública no build
  (`NEXT_PUBLIC_POSTHOG_ERRORS_KEY`) e, para o upload, a chave pessoal (`POSTHOG_CLI_API_KEY`) e o
  número do projeto (`POSTHOG_CLI_PROJECT_ID`) no environment do deploy.
- O SDK do navegador (≈ 127 KiB gz) só é baixado quando acontece um erro; o primeiro acesso ganha só
  o handler e os snippets dos chunk ids.
- Subir o `@posthog/cli` exige atualizar os sha256 fixados em `tools/posthog-cli/install-binary.mjs`
  (o script falha com a versão errada). Só Linux x64 e Windows x64 têm hash fixado.
- O Plano B (build nativo do Render) não roda o `inject`: lá a pilha dos erros não se resolve pelos
  source maps.
- O PostHog recebe o IP de quem manda o erro (o navegador), como no analytics; o texto publicado já
  cobre.

## Confirmação

- Unitários do scrubber, do reporter (só erro inesperado, flush em background, release por
  ambiente), da captura do navegador (SDK só no primeiro erro, sem persistência, `trace_id`), da CSP
  com e sem chave e dos `.map` fora do que é servido (`build-vercel-output`, Plano B e Caddy).
- E2E na stack de CI: um 500 da API vira `$exception` na UE com o `trace_id`, sem cookie nem
  storage; os chunks levam o chunk id e o `.map` responde 404.
- DoD da F6: erro de teste sem PII, com a pilha resolvida pelos source maps no staging.

## Opções descartadas

- **Sentry:** mais uma conta e um SDK no navegador; o PostHog cobre o que o desenho pedia.
- **Só Grafana:** sem agrupamento por issue, sem source maps e sem destino para os relatórios de CSP.
- **`postinstall` do `@posthog/cli`:** baixaria um binário sem checksum de `releases.posthog.com`.
- **`cookieless_mode: 'always'` na instância de erros:** depende de uma configuração do projeto e não
  acrescenta nada à `persistence: 'memory'`, que não grava nada no navegador.

## Mais informações

- Context7: `/posthog/posthog.com` (Error Tracking no Node e na web, `captureException`, source maps
  pelo CLI, CSP tracking, persistência e cookieless, API de captura, limites do plano Free).
- [Observabilidade](../architecture/observabilidade.md#erros), [frontend](../architecture/frontend.md#segurança-no-navegador),
  ADR 0002 (adendo de 2026-11-17) e mudança OpenSpec `add-error-tracking`.
