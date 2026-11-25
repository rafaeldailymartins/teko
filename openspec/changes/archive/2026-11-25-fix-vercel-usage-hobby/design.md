# Design

## Context

Estado em 2026-11-25: os dois projetos estão desativados pela Vercel (`402 DEPLOYMENT_DISABLED`)
depois de a conta passar de 4 h de Fluid Active CPU. O `vercel-usage` (mudança `add-usage-guard`)
lia o uso com `vercel billing usage --since 30d --json`, que no Hobby falha sempre. Conferido nesta
data com o Vercel CLI 65.11.0 de `tools/vercel-cli` e o login do mantenedor, só leitura:

| Fonte | Resposta no Hobby |
| --- | --- |
| `vercel billing usage --since 30d --json` (usa o `/v2/billing/costs` interno) | 404 `costs_not_found`: "Billing cost data is unavailable [...] no active subscription" |
| `GET /v1/billing/charges` (FOCUS v1.3, documentado) | 404 "Costs not found" |
| `vercel metrics vercel.function_invocation.* --all`, janela iniciada há até 30 min | 200 (`summary` e `data` vazios com os projetos parados) |
| a mesma, janela iniciada há mais de 30 min (1 h, 12 h, 30 dias) | 402 `payment_required`: "Observability Plus is required for function invocations that start more than 30 minutes ago" |
| `vercel metrics vercel.request.count` e `vercel.request.fdt_total_bytes` | 402 `payment_required` em qualquer janela |
| `GET /v2/observability/schema` | 200 (lista as métricas) |

A lista de endpoints do CLI (`vercel api list`, a partir do OpenAPI público) não tem outro endpoint
de uso, limite ou cota do time: os de billing são o `/v1/billing/charges` e os de integrações do
Marketplace. A documentação diz que o Hobby recebe e-mail ao se aproximar da cota e que o dashboard
Usage e o `vercel billing usage` são os meios de consulta; o dashboard usa endpoints internos, não
documentados, e por isso ficam de fora.

## Goals / Non-Goals

**Goals:** uma medição que funcione no Hobby sem pagar nada, para os recursos que mais apertam
(CPU ativa, memória provisionada, invocações, Fast Origin Transfer); falha visível no mesmo dia;
estado que sobreviva entre execuções sem dar escrita no repositório aos jobs do `ops.yml`.

**Non-Goals:** medir Fast Data Transfer, CDN Requests, spans e imagens (sem fonte no Hobby); usar
endpoint não documentado do dashboard; medir CPU dentro da própria API (exigiria mexer no
`apps/api` e ler o Grafana com um token novo).

## Decisions

- **`vercel metrics` em janelas de até 27 minutos, a cada 10 minutos.** A janela começa no fim da
  anterior (ou 27 min atrás, o que for mais recente; 3 de folga para as quatro chamadas) e termina
  5 min antes de agora (atraso de ingestão). Uma chamada por métrica, com `--all --aggregation
  <sum|count> --since <ISO> --until <ISO> --granularity 1m --json --scope <time>`; o total sai do
  `summary` (coluna `<métrica>_<agregação>` com `.` e `/` trocados por `_`, como o
  `getRollupColumnName` do CLI). Resumo vazio é 0 (sem invocação); linha sem a coluna, JSON de erro
  ou saída sem JSON é falha.
- **Métricas.** CPU ativa = `function_cpu_time_ms` (ms → h). Memória provisionada =
  `function_duration_gbhr`: o Fluid cobra memória enquanto há requisição em andamento, e invocações
  concorrentes dividem a instância, então a soma dos GB-h de duração é um limite superior.
  Invocações = `vercel.function_invocation.count`. Fast Origin Transfer = `fot_total_bytes` das
  funções (o Tekó não tem middleware). As cotas continuam fixadas em `HOBBY_QUOTAS`.
- **Estado no cache do Actions.** `.vercel-usage/state.json` guarda, por dia UTC, os minutos lidos
  e o uso por recurso, mais o início do acompanhamento e o fim da última janela. Cada run restaura
  o cache mais recente (`restore-keys: vercel-usage-state-`) e grava uma chave nova
  (`vercel-usage-state-<run_id>-<attempt>`), porque o cache é imutável. GitHub Releases (ADR 0030)
  exigiria `contents: write` num job com o token da Vercel, o que o `ops.yml` proíbe. Perder o cache
  (expira 7 dias sem acesso) recomeça a contagem: a cobertura do resumo mostra isso.
- **Janela de 30 dias e cobertura.** Uso de 30 dias = soma dos dias da janela × (minutos
  acompanhados / minutos lidos). Lacuna (cron atrasado, run que falhou, cache perdido no meio) é
  preenchida pela média lida, nunca reduz o uso. Abaixo de 50% de cobertura, o resumo avisa.
- **Frequência.** Cron `3-59/10 * * * *`, fora da virada da hora (o Actions atrasa e descarta
  agendamentos no pico). O cron tem grupo de concorrência próprio no topo do workflow, para um run
  na fila não cancelar o diário pendente; o job tem o grupo `ops-vercel-usage`, que serializa
  medição, exercício e volta.
- **Falha visível.** Fonte que não responde: job vermelho, `::error`, sem sucesso e sem avançar o
  estado. O `teko-ops-job-stale` dispara com 6 h sem sucesso do `vercel-usage` ou sem nenhum sucesso
  em 10 dias (`absent_over_time(...) * 864000`): a ausência da série foi o que calou o alerta em
  2026-11-19.
- **402.** O `teko-deployment-paused` aceita 503 ou 402 no `/healthz`.

## Risks / Trade-offs

- **Confiança baixa a média.** A permissão de 30 minutos no Hobby vem da mensagem da API, não da
  documentação (que diz que só Web Analytics e Speed Insights saem sem Observability Plus): a Vercel
  pode fechá-la sem aviso. Nesse caso o job fica vermelho e o alerta dispara em 6 h.
- Pico curto que cai numa lacuna é extrapolado pela média, não visto. Atraso de ingestão acima de
  5 min perde o fim da janela.
- Os agendamentos do Actions neste repositório já atrasaram horas (o cron diário de 09:40 rodou
  entre 14h e 21h UTC); com lacunas grandes, a estimativa vale pouco, e o resumo mostra a cobertura.
- Recursos sem fonte (Fast Data Transfer, CDN Requests, spans, imagens) só têm o e-mail de uso da
  Vercel e a checagem manual.
- Cerca de 144 runs por dia do `ops.yml` (minutos ilimitados em repositório público).

## Context7

- `/openapi/openapi_vercel_sh`: endpoints de billing (`/v1/billing/charges`), de observabilidade
  (`/v2/observability/query`, `/v2/observability/schema`) e de pausa de projeto.
- `/websites/vercel`: `vercel billing usage`, `vercel metrics` (`--json`, acesso sem Observability
  Plus), retenção do Observability no Hobby, janela de 30 dias do Hobby, cobrança do Fluid (CPU
  ativa e memória provisionada).
- `/actions/cache`: chave única por run com `restore-keys` (cache imutável).
- `/websites/github_en_actions`: `schedule` (mínimo de 5 minutos, atrasos e descartes na virada da
  hora, `github.event.schedule`).
