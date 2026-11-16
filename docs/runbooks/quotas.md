# Runbook: RPD reais do Gemini e do Groq

O RPD (requisições por dia) e o RPM dos free tiers do Gemini e do Groq **não são legíveis por
API** e mudam sem aviso ([contas e cotas](../architecture/contas-e-cotas.md#limites-que-não-se-leem-por-api)).
O 429 é o sinal primário (alerta `teko-llm-429`), com breaker e fallback; esta tabela é a
referência para o dashboard **Tekó · Cotas** ("respostas por modelo (24 h)") e para dimensionar
`QUOTA_QUESTIONS_GLOBAL_DAILY`.

## Checagem mensal

Uma vez por mês (junto com a conferência do `infra/vercel/README.md`), e sempre que o 429 subir
sem tráfego novo:

1. **Gemini:** Google AI Studio → projeto `teko-prod` (e `teko-staging`) → Usage & limits → Rate
   limits. Anote RPM, TPM e RPD de cada modelo da cadeia (`GEMINI_MODEL_PRIMARY` e
   `GEMINI_MODEL_FALLBACK` em `infra/vercel/env.<ambiente>.json`). Confira também que o projeto
   continua **sem billing**.
2. **Groq:** console do Groq → Settings → Limits. Anote RPM, RPD, TPM e TPD do `GROQ_MODEL`, e
   confira que o Dev Tier continua desligado e o ZDR ligado.
3. Atualize a tabela abaixo com a data e o valor lido.
4. Compare com o dashboard: se as respostas por modelo em 24 h passam de 70% do RPD, reduza
   `QUOTA_QUESTIONS_GLOBAL_DAILY` ([quota-exhausted.md](quota-exhausted.md#cotas-da-aplicacao)).
   Uma pergunta gasta até duas chamadas com a reescrita ligada (`QUERY_REWRITE_ENABLED`).

## Limites lidos

Os valores são preenchidos pelo mantenedor na conta real; "—" é ainda não lido.

| Provedor | Modelo (env)                                     | RPM | RPD | TPM | Lido em |
| -------- | ------------------------------------------------ | --- | --- | --- | ------- |
| Gemini   | `GEMINI_MODEL_PRIMARY` (`gemini-3.5-flash-lite`) | —   | —   | —   | —       |
| Gemini   | `GEMINI_MODEL_FALLBACK` (`gemini-3.6-flash`)     | —   | —   | —   | —       |
| Groq     | `GROQ_MODEL` (`openai/gpt-oss-120b`)             | —   | —   | —   | —       |

## Outras cotas conferidas à mão

| Serviço            | Onde                                 | Referência                                                               |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------ |
| Workers AI         | Cloudflare → AI → Workers AI → Usage | 10k neurons/dia na conta (00:00 UTC)                                     |
| Langfuse Hobby     | Settings → Usage                     | 50k units/mês; sampler corta em 35k                                      |
| Grafana Cloud Free | Administration → Usage               | 10k séries ativas, 50 GB de logs, 100k execuções do Synthetic Monitoring |
| PostHog Free       | Organization → Billing → Usage       | volumes da [arquitetura](../architecture/contas-e-cotas.md)              |
