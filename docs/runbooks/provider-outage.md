# Runbook: provedor fora do ar, 5xx e latência

Cobre os alertas `teko-api-5xx`, `teko-api-questions-p95`, `teko-llm-ttft-p95` e
`teko-rag-lexical-only` (`infra/grafana/alerts.json`). A cadeia de LLM é Gemini primário → Gemini
de fallback → Groq ([ADR 0007](../adr/0007-cadeia-de-llm.md)); o embedding e o reranker são do
Workers AI ([ADR 0008](../adr/0008-bge-m3-e-halfvec.md), [ADR 0027](../adr/0027-reranker-workers-ai.md)).

## Como a API já se defende

- **Breaker por modelo** (`application/services/provider-router.ts`): um 429 abre o breaker até o
  `retry-after`; 3 falhas seguidas o abrem por 60 s. Com o breaker aberto, a pergunta vai direto
  para o próximo da cadeia, e cada troca conta em `teko_llm_provider_fallback_total{from,to}`.
- **Embedding fora do ar:** a busca cai para só o canal lexical (`retrieval_mode=lexical_only`), e
  a resposta continua, com qualidade menor.
- **Cache exato** de respostas (`ANSWER_CACHE_TTL_DAYS`): acerto de cache responde mesmo com o
  kill switch ligado.

<a id="5xx-na-api"></a>

## 5xx na API

1. Dashboard **Tekó · API (RED)**: qual rota e qual ambiente. Um pico só em `/api/v1/questions*`
   costuma ser provedor; em todas as rotas com banco, o Neon.
2. Abra um trace do período no Grafana (Explore → Tempo, filtro `service.name=teko-api` e
   `status=error`); o `x-trace-id` que o usuário vê na UI ("ID de suporte") leva direto a ele.
3. Causas e saídas:
   - **Neon suspenso ou sem CU-h** (erros de conexão em todas as rotas com banco): runbook
     [neon-suspended.md](neon-suspended.md).
   - **Provedor de LLM** (503 `upstream_unavailable` só nas perguntas): seção abaixo.
   - **Deploy recente** (o pico começa no horário do `promote`): volte para a deployment anterior
     pelo runbook `release-rollback.md` (F7).
   - **Vercel** (503 no `/healthz` também): runbook [vercel-paused.md](vercel-paused.md).

## Provedor de LLM fora do ar

1. Dashboard **Tekó · LLM**: erros por provedor e status, fallback e TTFT. Confirme na página de
   status do provedor (Google AI Studio, Groq).
2. Um provedor só: o breaker e o fallback já resolvem; acompanhe a fração de 429
   ([quota-exhausted.md](quota-exhausted.md#429-por-provedor)) e o TTFT do fallback.
3. Cadeia inteira fora, ou fallback com latência inaceitável: troque os modelos por env no projeto
   Vercel (Config, sem segredo) e faça redeploy da deployment atual:
   - `LLM_PROVIDER=groq` usa só o Groq;
   - `GEMINI_MODEL_PRIMARY`, `GEMINI_MODEL_FALLBACK` e `GROQ_MODEL` trocam os modelos (os valores
     versionados ficam em `infra/vercel/env.<ambiente>.json`; atualize o arquivo no mesmo dia,
     senão o próximo sync do deploy desfaz a troca).
4. Sem nenhum provedor utilizável: ligue o kill switch, `LLM_KILL_SWITCH=true` no projeto +
   redeploy. Acerto de cache continua respondendo; o resto recebe 503 `service_paused`. A variável
   fica fora do `env.*.json` para um deploy seguinte não a desligar: desligue à mão quando o
   provedor voltar.

<a id="latencia"></a>

## Latência (p95 da criação da pergunta ou TTFT)

- **TTFT p95 > 3 s num provedor:** em geral fila do free tier. Se persistir por mais de uma hora,
  inverta a ordem (`LLM_PROVIDER=groq`) até normalizar.
- **p95 de `POST /api/v1/questions` > 3 s:** a criação inclui a reescrita da pergunta
  (`QUERY_REWRITE_ENABLED`), a busca híbrida e o reranker. Veja o retriever `retrieve-context` do trace no Langfuse: com
  o reranker lento, `RERANKER_PROVIDER=none` desliga o reranker (a ordem do RRF continua); com a
  reescrita lenta, `QUERY_REWRITE_ENABLED=false`.
- Cold start + resume do Neon (até cerca de 10 s) aparece como pico isolado depois de horas sem
  tráfego; não é incidente.

<a id="embeddings"></a>

## Embeddings fora do ar (`lexical_only`)

1. Dashboard **Tekó · Sinais de RAG**: fração `lexical_only` e a recusa por motivo
   (`no_evidence` sobe junto).
2. Confira a cota de neurons do dia (dashboard **Tekó · Cotas**, `teko_quota_used_ratio`): os 10k
   neurons diários da conta zeram às 00:00 UTC e a ingestão usa até 8.000. Neurons esgotados →
   [quota-exhausted.md](quota-exhausted.md#cotas-da-aplicacao).
3. Workers AI fora do ar (status da Cloudflare): nada a fazer além de acompanhar; a API já
   responde só com a busca lexical. Se a recusa passar do aceitável, ligue o kill switch como
   acima.
