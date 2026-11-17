# Design

## Context

O Grafana as code (`infra/grafana/`, mudança `add-uptime-monitoring`) tem três checks HTTP da sonda
pública `SaoPaulo`, todos com `basicMetricsOnly`: os `/healthz` de produção e de staging a cada
5 min e a landing de produção a cada 15 min. O único alerta sobre eles é o
`teko-deployment-paused` (`probe_http_status_code == 503` nos `/healthz`). Medido em 2026-11-17:
os dois `/healthz` respondem 200 e a landing de produção responde 404, porque o web de produção só
é publicado no deploy da F7.

## Goals / Non-Goals

**Goals:** e-mail quando um check fica fora do ar por qualquer motivo, sem ruído de uma falha
isolada; nenhuma execução gasta num alvo que ainda não existe; a conta da cota coerente com o que
roda de fato.

**Non-Goals:** mais sondas (multiplicam execuções), alerta por latência do check, aplicar contra a
stack real, ligar o check da landing antes da F7.

## Decisions

- **`probe_success` com `max_over_time` em 20 min.**
  `max by (job, instance) (max_over_time(probe_success{job=~"teko-.+"}[20m]))` com `op: lt` e
  limiar 1: o valor só fica abaixo de 1 se nenhuma execução da janela teve sucesso. É o mesmo
  padrão do cálculo de uptime do app do Synthetic Monitoring (`max_over_time(probe_success[...])`).
  Vinte minutos cobrem 4 execuções dos `/healthz` (5 min) e 1 ou 2 da landing (15 min), então uma
  falha isolada não dispara. `for: 0s` porque a janela já faz o papel do `for`; somar um `for`
  atrasaria o e-mail sem ganho. `rangeSeconds: 1200`, como as outras regras com janela própria.
  `max by (job, instance)` tira o rótulo `probe` e o `config_version`: com mais sondas no futuro,
  basta uma ter sucesso para o check contar como no ar (a queda de uma sonda não vira alerta).
- **Crítico.** Um `/healthz` sem sucesso por 20 min é a API ou a plataforma fora do ar.
- **Junto com o `teko-deployment-paused`.** Um 503 também zera o `probe_success` (o check só aceita
  200). O `teko-deployment-paused` dispara na primeira execução com 503 e diz a causa; o
  `teko-synthetic-failed` chega 20 min depois. Excluir o 503 da regra nova deixaria um buraco se o
  503 vier de outra coisa; os dois e-mails são aceitáveis e o runbook diz qual seguir.
- **Sem dado, sem alerta.** Como as demais regras, `noDataState: OK`: um check desligado para de
  gerar amostras e sai do alerta quando a janela de 20 min esvazia; uma sonda totalmente fora não
  gera amostra e o alerta fica em Normal (o runbook cita o buraco).
- **Landing desligada, não removida.** `enabled: false` mantém o check no arquivo e na stack (o
  apply o cria desligado), e ligar na F7 é trocar um valor. Removê-lo faria o apply apagá-lo e a
  F7 teria de reescrevê-lo. O motivo fica no `$comment` do arquivo (o corpo do check vai inteiro
  para a API, então um `$comment` por check iria junto) e no README.
- **Check desligado conta 0.** O Synthetic Monitoring cobra cada execução feita, por sonda; check
  desligado não executa. `monthlyExecutions` devolve 0 para `enabled: false`, e a validação, o plano
  e o resumo do apply usam a mesma função. O teste afirma 17.280 hoje e 2.880 para a landing
  ligada; a validação passa a exigir `enabled` booleano, para um valor ausente não sair da conta
  por engano.

Alternativas consideradas: `probe_all_success` (resumo com `_sum` e `_count`), descartado porque a
própria doc do app mostra que ele atrasa e arredonda falhas isoladas; `avg_over_time` com limiar
(ex.: < 0,5), que dispara com metade das execuções falhando, descartado para não acordar o
mantenedor por instabilidade passageira, que o painel já mostra; um `for: 15m` sobre
`probe_success == 0` instantâneo, descartado porque a avaliação instantânea olha só a última
amostra, e uma amostra boa no meio reinicia o `for` de forma menos previsível que a janela.

## Risks / Trade-offs

- **Sonda única.** Uma falha só da `SaoPaulo` (rede da sonda) vira alerta de todos os checks ao
  mesmo tempo; o runbook ensina a distinguir pelo `curl` de fora e pela página de status do Grafana.
- **Atraso de 20 min.** Uma queda curta (menos de 20 min) não gera e-mail; o painel e o
  `teko-api-5xx` cobrem quedas com tráfego.
- **Check religado após falha.** Ao ligar a landing na F7 sem o web no ar, o alerta dispara na
  primeira execução falha (a janela só tem uma amostra). É o comportamento desejado: o DoD da F7
  pede execuções verdes.

## Fontes Context7

| Biblioteca / serviço                   | ID                                  | Consulta                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana (docs do Synthetic Monitoring) | `/websites/grafana`                 | métricas comuns a todo tipo de check (`probe_success`, `probe_duration_seconds`, `sm_check_info`) e métricas do check HTTP (`probe_http_status_code`)                                                  |
| Synthetic Monitoring App               | `/grafana/synthetic-monitoring-app` | `probe_success` é gauge 0/1 por `job` e `instance`; uptime por `max_over_time(probe_success[...])`; por que `probe_all_success` atrasa e arredonda                                                       |
| Grafana Cloud                          | `/websites/grafana_grafana-cloud`   | cobrança por execução feita, por sonda ("Each probe run counts as a separate execution for billing")                                                                                                  |
| Neon                                   | `/neondatabase/website`             | API key project-scoped: papel Editor no projeto (lê e altera recursos, não apaga o projeto nem gerencia acesso); não há chave só de leitura. Corrige o item 8 do `infra/grafana/README.md`          |

Nenhuma página do Context7 diz o que o `basicMetricsOnly` corta. Isso foi conferido na fonte do
agente (`grafana/synthetic-monitoring-agent`, `internal/scraper/testdata/http_basic.txt`, commit
`917449a` de 2026-11-02): a saída esperada de um check HTTP com `basicMetricsOnly` traz
`probe_success`, `probe_http_status_code` e `probe_duration_seconds` como gauges.
