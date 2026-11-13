# Roteiro do Tekó

Fases F4 a F10, com o que cada uma entrega e o DoD. F0 a F3 estão concluídas
([status](status.md)). O desenho de cada área está em [`architecture/`](architecture/README.md);
as decisões, nas [ADRs](adr/README.md). Este roteiro substitui a seção "Roteiro por fases" do
plano de 2026-11-10, congelado em 2026-11-12.

## Convenções

- **OpenSpec só quando muda requisito.** Uma fase abre mudança OpenSpec quando o comportamento
  descrito em `openspec/specs/**` muda; a mudança é proposta, implementada e arquivada no mesmo PR.
  As mudanças citadas abaixo são as previstas, não uma obrigação de forma.
- **Context7 antes de implementar** toda biblioteca, CLI ou serviço; IDs no `design.md` da mudança
  (ou na ADR, quando não houver mudança).
- Uma fase termina com o DoD provado, `pnpm spec:validate` verde, o [status](status.md) atualizado
  e as ADRs da fase escritas.
- Decisão que contrarie este roteiro ou a arquitetura precisa do aval do mantenedor; depois, o
  documento e a ADR são corrigidos no mesmo PR.

## Revisão antes da F4 (2026-11-12)

Pacotes aprovados pelo mantenedor, um PR por pacote:

| Pacote | Branch                         | Entrega                                                                                                                                            | ADR        |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A      | `fix/api-runtime-revisao`      | aviso de fronteira do PA, degradação de embeddings e reranker, pool e retry, cache da cobertura, um só caminho de escrita do corpus                | —          |
| B      | `fix/ingestao-revisao`         | lacunas de cobertura na promoção, orçamento em UTC, guardas de tamanho, churn e saúde, `EXTRACTOR_REVISION`, índices parciais, linhagem e rollback | 0031       |
| B2     | `ci/ragops-gates`              | `corpus-eval` bloqueando o PR do lock, golden `dev`/`holdout`, IC no resumo, modo `eval-only`, histórico                                           | 0031       |
| C      | `feature/web-api-mesma-origem` | web e API na mesma origem na Vercel, Netlify fora, artefatos no GitHub Releases (etapa C1)                                                         | 0029, 0030 |
| C2     | (depois do C1 migrado)         | remove o adapter, o comando e o workflow de migração do Netlify Blobs                                                                              | 0030       |
| D      | `ci/gates-enxutos`             | Stryker só no nightly, audit fora do PR, Sonar informativo, Codecov fora, `pnpm verify`, spikes apagados                                           | 0032       |
| E      | `docs/plano-no-repositorio`    | este roteiro, `architecture/`, `status.md`, `CLAUDE.md` só com regras, ADR 0033 (trunk-based)                                                      | 0033       |

Depois dos PRs: as ações manuais do trunk-based (ADR 0033), executadas em 2026-11-13, e o PR de
seguimento que troca `develop` por `main` no código.

## F4: API completa

- **Mudanças previstas:** `add-api-foundation`, `add-auth-oauth-passkey`,
  `add-ask-question-streaming`, `add-llm-provider-chain`, `add-quota-guards-and-cache`,
  `add-privacy-guards`.
- **Entregas:**
  - superfície HTTP canônica, rotas de eval em plugin separado (só `APP_ENV=ci`), asserções de boot;
  - Better Auth com OAuth GitHub/Google e passkey, `generateId: 'uuid'`, `ipAddressHeaders:
    ['x-real-ip']`, rate limit em `database`;
  - `POST /questions` com `pg_advisory_xact_lock` por usuário, `QuotaGuard`, reserva de
    `stream_seconds` antes do stream e cache exato; stream same-origin com cookie e `Origin`, claim
    atômico `pending → streaming` e UI Message Stream. **Sem proxy, sem ticket e sem CORS**;
  - cadeia de LLM com breakers, kill switch, PII redigida, política regional por país declarado ou
    `geolocation()`;
  - rate limit em Postgres só onde `QuotaGuard`, Better Auth e WAF não cobrem;
  - `no-store`, DSR e portas de erasure; `config/platform.ts` e adapters `platform/{vercel,node}`;
  - stack de CI (`infra/ci/`) com a API e o estático na mesma origem, e `e2e.yml` no `pr-gate.yml`;
  - `seed:dev-session` para o login local;
  - melhora do MRR no corpus real (reescrita da pergunta pelo LLM antes da busca e o que mais o
    diagnóstico do `holdout` apontar).
- **DoD:**
  - recusa fora da cobertura sem chamada ao `LLMPort` (spy);
  - mutação ou stream com `Origin` errado → 403; segundo stream da mesma pergunta → 409
    `stream_busy`; duas perguntas simultâneas do mesmo usuário respeitam a cota (integração);
  - desconexão aborta o LLM em menos de 1 s; embedding fora do ar → `lexical_only`;
  - boot falha com base URL ou `*_BASE_URL` inesperada; nenhuma PII válida no payload do LLM;
  - fora da Vercel, no SIGTERM, perguntas novas dão 503 e streams ativos terminam; na Vercel, o
    handler termina em menos de 500 ms;
  - stream cortado em 100 s por timer próprio, com `error` retryable;
  - rate limit vale entre duas instâncias apontando para o mesmo Postgres;
  - `/api/v1/_eval/*` → 404 com `APP_ENV=staging`; query string em `POST /questions` → 400;
  - contrato OpenAPI e chunks verdes; sessão revogada por `DELETE /me` não lê dados depois do
    acesso ao banco (janela do `cookieCache` documentada);
  - **MRR ≥ 0,70 no `holdout` do `corpus-eval`**, sem regressão no `dev`.

## F5: Frontend completo

- **Mudanças previstas:** `add-web-shell-and-design-system`, `add-chat-experience`,
  `add-i18n-en-ptbr`, `add-auth-ui`.
- **Entregas:** design system (shadcn sobre Base UI, tokens OKLCH, tema), app shell, chat com o
  transporte same-origin, data de referência, cobertura, citações e diff, i18n en/pt-BR, páginas
  legais, consentimento, headers e CSP gerados no build, 404 por locale e redirect por idioma nas
  rotas do Build Output, orçamento de bundle total. Estrutura `app/ components/ lib/`, sem FSD.
- **Fora (cortes de 2026-11-12):** Storybook, Stryker no web, playwright-bdd, regressão visual,
  LHCI e orçamentos por rota.
- **DoD:**
  - o build do web gera só estático (sem route handlers nem functions do Next);
  - axe zero nas rotas principais, en/pt-BR, claro/escuro, desktop/mobile;
  - e2e (5 a 8 jornadas, Chromium + viewport mobile) verde;
  - 05/2008 → 01/2010 altera resposta, citação e intervalo;
  - antes do consentimento, zero cookies e zero chaves do PostHog no storage;
  - paridade i18n e cliente gerado sem drift; orçamento de bundle total respeitado.

## F6: Observabilidade (em paralelo com a F5 depois que a F4 estabilizar)

- **Mudanças previstas:** `add-otel-telemetry`, `add-llm-tracing-langfuse`, `add-error-tracking`,
  `add-product-analytics`, `add-uptime-monitoring`.
- **Entregas:** OTel 2.x com OTLP direto ao Grafana Cloud e flush por `BackgroundTasks`; Langfuse
  com `TraceSampler`, `pricing.json` e `costDetails`; PostHog (produto e Error Tracking, se cobrir
  source maps e relatório de CSP; senão Sentry); Grafana as code e Synthetic Monitoring; `ops.yml`;
  sinais de RAG em produção e annotation queue do 👎 (ADR 0031); runbooks de operação.
- **DoD:**
  - mesmo `trace_id` no navegador, no Grafana, no Langfuse e no destino de erros, inclusive quando o
    navegador não amostrou;
  - custo por consulta no Langfuse e `shadow_cost_usd` em 100% das linhas de `app.questions`;
  - projeção do Langfuse < 35k units;
  - erro de teste sem PII, com stack resolvida pelos source maps;
  - 100 perguntas de teste no staging geram 100 traces completos;
  - `/healthz` monitorado não incrementa CU-h em 24 h;
  - painel de sinais de RAG com recusa por motivo, `lexical_only` e citações invalidadas.

## F7: Deploy de staging e produção

- **Mudanças previstas:** `add-vercel-deployment`, `add-deploy-pipelines`, `add-smoke-tests`,
  `add-usage-guard`.
- **Entregas:** WAF aplicado (`infra/vercel/firewall-rules.json`), sync de env, deploy único do
  `.vercel/output` (estático + Function) com tarball atestado, smoke e system test; `vercel-usage`
  e `weekly-maintenance` no `ops.yml`; job `neon-rehearsal` reutilizável; Plano B no Render servindo
  estático e API e o primeiro ensaio de corte; runbooks de deploy, pausa, kill switch e rollback.
- **DoD:**
  - stream de 90 s no domínio de produção sem corte, inclusive com deploy e `promote` no meio;
  - `teko-api*.vercel.app` → 308 para o canônico; cookie e passkey funcionando só no canônico;
  - smoke com falha simulada reverte o deploy (`vercel rollback` + `promote` depois da correção) em
    até 10 min; `promote` de uma deployment mais antiga e redeploy do tarball de um release testados;
  - `gh attestation verify` do tarball bate com a `meta.artifactSha256` em produção;
  - nenhuma Sensitive no `.vercel/output`, no tarball nem nos artifacts;
  - kill switch exercitado no staging (85% liga `LLM_KILL_SWITCH`; 95% troca a regra 1 do WAF);
  - cold start p95 + resume do Neon abaixo de 10 s;
  - purge semanal comprovado contra o staging;
  - ensaio do Plano B: smoke verde contra o host do Render e volta ao estado parado.

## F8: Evals de geração, red team, desempenho e segurança

- **Mudanças previstas:** `add-generation-evals`, `add-llm-red-team`,
  `add-performance-load-tests`, `add-security-testing`.
- **Entregas:** `evals.yml` (geração por modelo da cadeia, juiz diferente do gerador quando o
  gerador for o Groq; perfil `pr` no `pr-gate.yml`), red team, k6 `smoke` e `load` na stack de CI,
  ZAP baseline (CI e passivo semanal no staging), SBOM e atestações, Grype e `prod-vuln-scan`
  diário, primeira rodada de usabilidade (SUS registrado, não é DoD).
- **DoD:**
  - faithfulness ≥ 0,90 e citação correta (dispositivo, versão, intervalo) ≥ 95%;
  - ASR ≤ 5% (0% em extração, PII e policy);
  - k6 `load` dentro dos thresholds;
  - ZAP sem high nem medium;
  - nenhuma vulnerabilidade high/critical no lockfile, no bundle de runtime e na imagem da stack.

## F9: Documentação e release v0.1.0

- **Mudanças previstas:** `add-project-documentation`, `add-release-process`.
- **Entregas:** READMEs, CONTRIBUTING, SECURITY, ADRs e runbooks atualizados; `release.yml` com o
  `release-gate` como job e produção por tag `v*` (ADR 0033); `v0.1.0` imutável com SBOM,
  atestação e o tarball do `.vercel/output`.
- **DoD:**
  - produção no ar pela tag, com `release-gate` e smoke verdes;
  - Vercel projetada < 50% em todos os recursos do Hobby (7 dias medidos pelo `vercel-usage`);
  - CU-h < 70 por projeto (7 dias medidos e projetados);
  - Scorecard ≥ 7;
  - `gh release verify v0.1.0` e `gh attestation verify` do tarball, com o sha256 igual à
    `meta.artifactSha256` da deployment de produção.

## F10: Onda C3 (Anexos VIII e IX) e v0.2.0

- **Mudanças previstas:** `add-rcte-annexes-viii-ix`, `enforce-trusted-types`.
- **Entregas:** parser em streaming para os arquivos de 57 e 73 MB; mais 12 casos no golden
  (divididos entre `dev` e `holdout`); Trusted Types em enforce depois de 14 dias sem violação;
  release v0.2.0.
- **DoD:**
  - métricas de retrieval e geração sobre o golden ampliado;
  - Neon de produção ≤ 800 MB; se não couber, os Anexos ficam com as linhas vigentes e as dos
    últimos 5 anos, com a lacuna explícita em `coverage`;
  - Scorecard ≥ 8 (repositório com mais de 90 dias).

## Cortes e adiamentos

Decididos na revisão de 2026-11-12.

**Cortados:**

- playwright-bdd 1:1 com o OpenSpec e o `spec-trace` (fica o e2e Playwright de 5 a 8 jornadas);
- FSD e steiger; Stryker no web e mutmut; Storybook com `addon-vitest`;
- k6 `stress`, `breakpoint`, `spike` e `soak` semanais (ficam `smoke` e `load` pré-release);
- autocannon/bench com "regressão > 15%" bloqueando (tempo vira informativo; o `sql-perf` continua
  gate);
- e2e em 4 shards, Firefox, WebKit e regressão visual (fica Chromium + viewport mobile);
- Checkly, UptimeRobot e Codecov; git-flow-next local; `pages-fallback.yml` e o runbook
  `netlify-paused.md` (saem com a Netlify; o Plano B serve o estático).

**Adiados para depois da v0.1.0:**

- Trusted Types em enforce (F10);
- SUS ≥ 80 como DoD;
- Lighthouse CI e orçamentos por rota (fica o orçamento de bundle total);
- ZAP API scan (fica o baseline passivo semanal).

**Política de vulnerabilidades:** Grype com hotfix em 24 h só para high e critical; as demais
severidades entram no próximo release.

## Riscos principais

| Risco                                                            | Mitigação                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Uma cota do Hobby estoura e a Vercel pausa web e API por 30 dias | tetos na aplicação, WAF, `vercel-usage` com kill switch, nenhuma carga contra a Vercel, Plano B ensaiado (que agora serve também o estático) |
| CU-h ou espaço do Neon esgotam                                   | `/healthz` sem DB, cache da cobertura, guardas de 800 MB, índices parciais e poda de vetores                                                 |
| Gemini muda cotas ou modelos                                     | IDs em env, breaker, Groq, cache, kill switch                                                                                                |
| Vigência errada no parser                                        | golden cp1252, propriedades, `review_queue` fora da produção, disjuntor de churn, gate de saúde                                              |
| Corpus ruim chega à produção                                     | `corpus-eval` bloqueando o lock, `holdout`, linhagem e rollback do corpus                                                                    |
| LGPD (treino no Gemini; Termos do Hobby)                         | redação, aviso, 18+, EEE/UK/CH só no Groq, DSR com erasure, opt-out de Model Training                                                        |
| Cadeia de suprimentos                                            | pin por SHA, harden-runner, `minimumReleaseAge`, `trustPolicy`, osv, Grype, atestação antes do deploy                                        |
| `VERCEL_TOKEN` estático vaza                                     | token por environment, revisor em produção, 90 dias, alerta 30 dias antes                                                                    |
| Comportamentos não documentados da Vercel                        | heartbeat, rollback ancorado no tarball do release, Build Output pelo tsdown (ADR 0017)                                                      |
