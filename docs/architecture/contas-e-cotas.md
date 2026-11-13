# Contas, cotas e guard rails

Custo zero absoluto: só planos gratuitos que **param** ao atingir a cota, 2FA em todas as contas,
nenhum billing ativo e nenhum cartão cadastrado. Os números de uso são estimativas de pior caso,
conferidas pelo `ops.yml` a partir da F6/F7.

## Contas

| Serviço                                                                   | Uso                                                                  | Plano        | Segredos → destino                                                                                     | Guarda de custo                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| GitHub + App `teko-release-bot` + 2 OAuth apps                            | repositório, CI, Releases (artefatos de ingestão), atestações, login | Free         | chave da App → repositório; OAuth → Sensitive da Vercel                                                | —                                                                                      |
| Vercel (projetos `tekoia`, `tekoia-staging`)                              | web estático + API (uma Function Fluid), `gru1`, Git não conectado   | Hobby        | `VERCEL_TOKEN` por environment (90 dias); `VERCEL_USAGE_TOKEN` → `ops`; bypass de automação            | uso não comercial; opt-out de Model Training; guarda diária com kill switch; nunca Pro |
| Neon (`teko-prod`, `teko-staging`, `aws-sa-east-1`, PG18)                 | Postgres                                                             | Free         | URLs por role → environments e Vercel; API keys project-scoped → `ops`, `staging`, `release-rehearsal` | CU mínimo, scale-to-zero                                                               |
| Google AI Studio (`teko-prod`, `teko-staging`, `teko-ci`) + Cloud (OAuth) | Gemini e login Google                                                | free         | chaves → Sensitive da Vercel e environment `evals`                                                     | sem billing; checagem mensal                                                           |
| Groq (ZDR ligado)                                                         | fallback e juiz                                                      | Free         | chaves → Vercel e `evals`                                                                              | não ativar Dev Tier                                                                    |
| Cloudflare                                                                | Workers AI (BGE-M3 e reranker)                                       | Workers Free | token com escopo Workers AI → Vercel e environments                                                    | nunca Workers Paid                                                                     |
| Langfuse Cloud (EU)                                                       | traces e custo de LLM                                                | Hobby        | chaves por projeto → Vercel; par de admin → `ops`                                                      | sampler com corte em 35k units                                                         |
| Grafana Cloud                                                             | OTLP direto, alertas e Synthetic Monitoring                          | Free         | endpoint e token OTLP → Vercel; SA token → `ops`                                                       | sem spans de health                                                                    |
| PostHog (EU)                                                              | analytics, surveys e, se atender, Error Tracking                     | Free         | project key → build; personal key → Vercel (erasure)                                                   | replay off                                                                             |
| Sentry (EU)                                                               | só se o PostHog Error Tracking não atender (F6)                      | Developer    | DSN → build/Vercel                                                                                     | sem trial; spike protection                                                            |
| SonarQube Cloud                                                           | análise informativa de PRs e do branch principal                     | Free (OSS)   | `SONAR_TOKEN` → repositório e Dependabot                                                               | —                                                                                      |
| Stryker Dashboard, OpenSSF Best Practices                                 | badge de mutação; selo `passing` (projeto 16550)                     | OSS          | `STRYKER_DASHBOARD_API_KEY` → repositório                                                              | —                                                                                      |
| Socket.dev (GitHub App)                                                   | SCA de supply chain no PR                                            | Free (OSS)   | nenhum                                                                                                 | só o repositório `teko` liberado                                                       |
| Render                                                                    | Plano B (web service `teko-api-planb`, Virginia)                     | Free         | segredos de runtime de produção → env do serviço; deploy hook → `production`                           | serviço parado fora do ensaio; nenhuma forma de pagamento                              |

**Saíram na revisão de 2026-11-12:** Netlify (web e Blobs, ADRs 0029 e 0030), Codecov (o gate é o
threshold do Vitest, ADR 0032), Checkly e UptimeRobot (o Synthetic Monitoring do Grafana cobre).
Os artefatos foram migrados para o GitHub Releases em 2026-11-13 (ADR 0030); o mantenedor revoga
os tokens (`NETLIFY_AUTH_TOKEN` e a variável `NETLIFY_SITE_ID` do environment `staging`,
`CODECOV_*`, `CHECKLY_*`) e encerra as contas.

## Vercel Hobby

Cotas mensais da conta, somando `tekoia` e `tekoia-staging`; o Hobby não compra uso extra.
Premissa de pior caso: tetos diários de perguntas e `stream_seconds` atingidos todo dia, 20 s de
stream em média, cerca de 30k chamadas curtas e 150k requests de estático por mês.

| Recurso              | Cota Hobby | Premissa                                                                                                           | Uso esperado/mês        |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Provisioned Memory   | 360 GB-h   | streams (6.000 + 1.500) s/dia × 30 ≈ 62 h; chamadas curtas ≈ 2,5 h; `waitUntil` ≈ 1,5 h; cold starts e pings ≈ 2 h | cerca de 136 GB-h (38%) |
| Active CPU           | 4 h        | só com código rodando: streams, chamadas curtas, cold starts, pings                                                | cerca de 0,9 h (23%)    |
| Invocações           | 1M         | chamadas curtas, streams e pings de 5 min nos dois projetos; o estático não invoca a Function                      | cerca de 60k (6%)       |
| Fast Origin Transfer | 10 GB      | só CDN ↔ Function: cerca de 10 KB por stream e 5 KB por chamada curta                                              | cerca de 0,3 GB (3%)    |
| Fast Data Transfer   | 100 GB     | estático (cerca de 3 GB) + respostas da API                                                                        | cerca de 3,3 GB (3%)    |
| CDN Requests         | 1M         | estático (cerca de 150k) + API (cerca de 70k)                                                                      | cerca de 220k (22%)     |
| Deployment storage   | 10 GB      | cerca de 25 MB por deployment retida (estático + Function), staging a cada push                                    | cerca de 1,5 GB (15%)   |
| Spans de tracing     | 1M         | tracing próprio da Vercel desligado pelo SDK de OTel                                                               | próximo de 0            |
| Deploys              | 100/dia    | um por push no tronco e um por release                                                                             | < 10/dia                |

- **Tráfego negado pelo WAF** (deny, challenge ou rate limit) não conta CDN Requests nem Fast Data
  Transfer, e não invoca a Function.
- O recurso mais apertado é a memória provisionada: esperar o LLM não gasta CPU, mas mantém os
  2 GB da instância cobrando. O teto de `stream_seconds` limita isso na aplicação.
- **Ao estourar:** sem ciclo de cobrança, "na maioria dos casos" o recurso fica bloqueado até
  passarem 30 dias, e a produção responde 503 `DEPLOYMENT_PAUSED`. **A retomada de um projeto
  pausado é manual** (`vercel project resume <projeto>` ou `POST /v1/projects/{id}/unpause`), e o
  runbook `vercel-paused.md` cobre o passo. Spend Management é só do Pro. Os Termos também permitem
  encerrar a conta por exceder limites.

**Guard rails.**

- Tetos na aplicação (perguntas, `stream_seconds`, 100 s por stream, `bodyLimit`) abaixo das cotas,
  e o WAF negando `/api` desconhecido antes de invocar a Function.
- Job diário `vercel-usage` do `ops.yml` (`vercel usage --since 30d --json`, comparado com as cotas
  fixadas no script, porque a saída traz o uso e não o saldo; janela de 30 dias): emite
  `teko_vercel_usage_ratio{resource}`.
- 50% e 75%: alerta por e-mail. **85%:** kill switch de geração (`LLM_KILL_SWITCH=true` nos dois
  projetos + redeploy da deployment atual; fica fora do `env.*.json` para um deploy seguinte não o
  desligar). **95%:** a regra 1 do WAF passa a negar tudo exceto `/healthz` e o estático da página
  de aviso.
- Nenhuma carga contra a Vercel; nunca uma segunda conta (viola a política de uso justo).

## Neon

100 CU-h por projeto por mês. Metas: produção ≤ 70 e staging ≤ 40, já contando cerca de 0,7 CU-h
do `mark-coverage` diário. Limite de 1 GB por projeto: guarda de 800 MB na ingestão, aviso acima
de 400 MB no staging. O `ops.yml` lê o consumo pela API (sem acordar o compute) e emite
`teko_neon_cu_hours{env}`.

## Workers AI

10k neurons por dia na conta, zerados às 00:00 UTC: 8.000 para a ingestão
(`EMBED_NEURON_BUDGET`), 800 para a produção, 200 para o staging e 1.000 de folga. A carga
completa do staging custou cerca de 5 mil neurons; um ingest incremental, centenas.

## GitHub

Releases sem limite de tamanho total, com até 2 GiB por asset e cerca de 1.000 assets por release
(daí os shards). Minutos de Actions ilimitados em repositório público. Os artefatos de ingestão são
públicos: só documentos oficiais, snapshots do corpus e métricas, nunca dado de usuário.

## Demais cotas

- **Gemini free e Groq:** RPD/RPM reais lidos no AI Studio e no Groq (runbook `quotas.md`); 429 é o
  sinal primário, com breaker e fallback.
- **Langfuse Hobby:** 50k units/mês; o sampler corta em 35k projetados.
- **Grafana Cloud Free e PostHog Free:** volumes estimados bem abaixo dos limites; conferidos pelo
  `ops.yml` na F6.
- **Render Free:** 750 instance-hours por mês, só durante o corte do Plano B.

## Limites que não se leem por API

RPD do Gemini e do Groq e o comportamento do Langfuse ao estourar não são legíveis por API; o
`vercel usage` dá o uso, não o saldo, e a documentação não diz se a janela do Hobby é móvel ou
mensal. Contorno: checagem manual mensal registrada no relatório do `ops.yml`, cotas fixadas no
script, janela de 30 dias e margens defensivas.
