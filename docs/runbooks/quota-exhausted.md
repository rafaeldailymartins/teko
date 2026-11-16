# Runbook: cota estourando

Cobre os alertas `teko-quota-used`, `teko-llm-429` e `teko-langfuse-units`
(`infra/grafana/alerts.json`). Todas as contas são free tier que **param** ao atingir a cota
([contas e cotas](../architecture/contas-e-cotas.md)): estourar não gera cobrança, mas tira a
funcionalidade do ar até o ciclo virar. Neon e Vercel têm runbooks próprios
([neon-suspended.md](neon-suspended.md), `budget-kill-switch.md` na F7).

## Qual cota estourou

Dashboard **Tekó · Cotas** (`infra/grafana/dashboards/quotas.json`):

| Sinal                                          | Cota                                                              | Onde se ajusta                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `teko_quota_used_ratio{scope}`                 | tetos diários da aplicação (perguntas, `stream_seconds`, neurons) | `QUOTA_QUESTIONS_GLOBAL_DAILY`, `QUOTA_QUESTIONS_PER_USER_DAILY`, `QUOTA_STREAM_SECONDS_DAILY`, `QUOTA_NEURONS_DAILY` |
| `teko_llm_provider_errors_total{status="429"}` | RPM/RPD do Gemini free e do Groq                                  | modelos e ordem da cadeia por env ([provider-outage.md](provider-outage.md))                                          |
| `teko_langfuse_units_projected`                | 50k units/mês do Langfuse Hobby                                   | amostragem do `TraceSampler` por env                                                                                  |

<a id="cotas-da-aplicacao"></a>

## Cotas da aplicação acima de 70%

Os tetos diários (`usage_daily`, zerados à meia-noite de `America/Sao_Paulo`) existem para manter
a Vercel, o Workers AI e os provedores abaixo das cotas deles. Passar de 70% no meio do dia indica
uso acima da premissa de pior caso.

1. Veja qual `scope` subiu e desde quando; um usuário só pesa no `user_daily`, não no global.
2. Se o crescimento é legítimo e a cota de origem tem folga (Vercel abaixo de 50% no dashboard
   **Tekó · Vercel Hobby**, neurons abaixo de 800 por dia na produção), deixe o teto agir: ao
   chegar a 100%, a API responde 429 `quota_exceeded` com o `scope`, sem custo.
3. Se a cota de origem está apertada, **reduza** o teto no projeto Vercel (Config) e faça
   redeploy da deployment atual. Atualize `infra/vercel/env.<ambiente>.json` no mesmo dia.
4. Neurons: `QUOTA_NEURONS_DAILY` da produção (800) e do staging (200) somam com a ingestão
   (`EMBED_NEURON_BUDGET`, 8.000) dentro dos 10k da conta. Uma ingestão grande no mesmo dia reduz
   a folga: adie o `ingest.yml` em vez de subir o teto.

<a id="429-por-provedor"></a>

## 429 por provedor acima de 20%

1. Dashboard **Tekó · LLM**, painel "Fração de 429 por provedor", e **Tekó · Cotas**, "respostas
   por modelo (24 h)". Compare com o RPD de cada modelo em [quotas.md](quotas.md).
2. Perto do RPD do Gemini primário: o breaker já desvia para o fallback. Se o fallback também
   esgotar, `LLM_PROVIDER=groq` até a virada do dia (meia-noite do Pacífico no Gemini).
3. 429 no Groq (último da cadeia) com o Gemini esgotado: reduza `QUOTA_QUESTIONS_GLOBAL_DAILY`
   para o que sobra do RPD e, se preciso, `LLM_KILL_SWITCH=true` até a virada (cache continua).
4. **Nunca** ative billing no Google nem o Dev Tier do Groq: o Tekó é custo zero absoluto.

<a id="langfuse"></a>

## Langfuse acima de 35k units projetadas

O `TraceSampler` da produção amostra 1,0 até a projeção chegar a 35k e cai para 0,2 depois;
staging fica em 0,1. Acima de 35k com o corte já aplicado:

1. Confira a projeção no próprio Langfuse (Settings → Usage) e no dashboard **Tekó · Cotas**.
2. Reduza a amostragem por env no projeto Vercel (a variável da mudança `add-llm-tracing-langfuse`)
   e faça redeploy; staging pode ir a 0.
3. Em último caso, `LLM_TRACING_BACKEND=off` desliga os traces de LLM; o custo por consulta
   continua em `app.questions.shadow_cost_usd`.
