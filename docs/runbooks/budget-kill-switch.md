# Runbook: guarda de uso da Vercel (kill switch e lockdown)

Cobre os alertas `teko-vercel-usage-50` e `teko-vercel-usage-75` (`infra/grafana/alerts.json`) e o
que o job `vercel-usage` do `ops.yml` faz sozinho em 85% e 95%. A conta Hobby soma `tekoia` e
`tekoia-staging`, não compra uso extra e, ao estourar uma cota, pausa os projetos por cerca de
30 dias ([contas e cotas](../architecture/contas-e-cotas.md#vercel-hobby);
[vercel-paused.md](vercel-paused.md)).

## Onde ver

- Dashboard **Tekó · Vercel Hobby**: `teko_vercel_usage_ratio{resource}`, uso estimado dos últimos
  30 dias sobre a cota, por recurso medido (`active_cpu`, `provisioned_memory`,
  `function_invocations`, `fast_origin_transfer`).
- Resumo do job `vercel-usage` (Actions → Ops, a cada 10 min): a janela lida, a tabela de uso lido,
  estimado, cota e porcentagem, a cobertura e o que o job fez em cada projeto. Os recursos sem fonte
  no Hobby aparecem como "sem fonte no Hobby".
- Vercel → Usage, no dashboard: a única visão completa da conta (inclusive Fast Data Transfer e CDN
  Requests), sem API no Hobby. Confira à mão quando um alerta chegar.

<a id="fonte"></a>

## Fonte do uso e grau de confiança

No Hobby não há relatório de uso por API (conferido em 2026-11-25): o `vercel billing usage` e o
`GET /v1/billing/charges` respondem 404 `costs_not_found` porque a conta não tem assinatura, e a
Observability Plus, que abre o `vercel metrics` para janelas longas, não se compra no Hobby. O que
responde é o `vercel metrics` para as métricas de invocação de função da conta inteira, só em
janelas que comecem há no máximo 30 minutos. Daí a guarda:

- O `vercel-usage` roda a cada 10 minutos (cron `3-59/10 * * * *` do `ops.yml`) e lê a janela que
  ainda não contou: do fim da leitura anterior até 5 minutos atrás (atraso de ingestão), nunca mais
  de 27 minutos para trás. Uma chamada do `vercel metrics --all --json` por métrica:

  | Recurso                | Métrica                                                    | Observação                                                   |
  | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
  | `active_cpu`           | `vercel.function_invocation.function_cpu_time_ms` (soma)   | o recurso que pausou a conta em 2026-11-25                   |
  | `provisioned_memory`   | `vercel.function_invocation.function_duration_gbhr` (soma) | limite superior: invocações concorrentes dividem a instância |
  | `function_invocations` | `vercel.function_invocation.count`                         |                                                              |
  | `fast_origin_transfer` | `vercel.function_invocation.fot_total_bytes` (soma)        | só as funções (o Tekó não tem middleware)                    |

- As janelas somam por dia (UTC) em `.vercel-usage/state.json`, guardado no cache do Actions entre
  os runs. O uso de 30 dias é a soma dos dias, multiplicada por minutos acompanhados sobre minutos
  lidos: a lacuna (cron atrasado, run vermelho) vira a média do que foi lido.
- **Sem fonte no Hobby:** Fast Data Transfer, CDN Requests, spans de tracing e imagens
  (`payment_required` em qualquer janela). Esses só têm o e-mail de uso da Vercel e a Vercel → Usage.

**Grau de confiança: baixo a médio.**

- A janela de 30 minutos vem da mensagem da API, não da documentação (que diz que só Web Analytics
  e Speed Insights saem sem Observability Plus). Se a Vercel fechar a brecha, o job fica vermelho e
  o `teko-ops-job-stale` dispara em 6 h: a partir daí, a guarda é só a Vercel → Usage à mão.
- Pico curto dentro de uma lacuna não é visto, só extrapolado pela média. Os agendamentos do
  Actions neste repositório já atrasaram horas; a linha "Cobertura" do resumo diz quanto da janela
  foi lido (abaixo de 50%, o job avisa).
- O cache do Actions expira com 7 dias sem uso; perdido, a contagem recomeça do zero (cobertura e
  dias acompanhados voltam a crescer). Depois de uma retomada, a contagem também começa do zero.
- A memória provisionada é superestimada (concorrência), o que só antecipa o kill switch.

**Fonte que não responde** (erro do CLI, `payment_required`, formato novo): o job fica vermelho,
não registra sucesso, não avança o estado e não age. O `teko-ops-job-stale` dispara com 6 h sem
sucesso, ou com nenhum sucesso em 10 dias ([ops-alerts.md](ops-alerts.md#job-sem-sucesso)).
Enquanto isso, confira a Vercel → Usage todo dia e ligue o kill switch à mão
([abaixo](#ligar-a-mao)) se algum recurso passar de 85%.

## Limiares

| Uso estimado (qualquer recurso medido) | O que acontece                                                                                       | Quem age                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 50%                                    | e-mail (`teko-vercel-usage-50`)                                                                      | mantenedor: investigar               |
| 75%                                    | e-mail (`teko-vercel-usage-75`)                                                                      | mantenedor: cortar consumo           |
| **85%**                                | `LLM_KILL_SWITCH=true` nos dois projetos + redeploy da deployment de produção atual                  | `vercel-usage`, sozinho              |
| **95%**                                | além disso, lockdown: a regra 1 do WAF manda tudo (menos `/healthz`) para `/aviso/`                  | `vercel-usage`, sozinho              |
| 100%                                   | a Vercel pausa os projetos (503 `DEPLOYMENT_PAUSED`) ou desativa a conta (402 `DEPLOYMENT_DISABLED`) | [vercel-paused.md](vercel-paused.md) |

O job **nunca desliga** o kill switch nem o lockdown: a volta é sempre manual (abaixo). Ele é
idempotente: com o kill switch já ligado e a deployment de produção mais nova que a variável, não
grava nem redeploya de novo; o lockdown é reaplicado a cada execução acima de 95% (o
`vercel-firewall.ts` só muda o que difere).

<a id="cinquenta-por-cento"></a>

## 50%: investigar

1. Qual recurso subiu? No dashboard, compare com a premissa de pior caso da tabela da Vercel em
   `contas-e-cotas.md`. O mais apertado é a memória provisionada (streams longos).
2. Tráfego anormal? Dashboard **Tekó · API (RED)** por rota; Vercel → Firewall (o tráfego negado
   pelo WAF não conta CDN Requests nem Fast Data Transfer).
3. Deploys demais? Cada deployment retida ocupa armazenamento; cada build de push no tronco também
   gasta. Não há o que fazer além de evitar pushes desnecessários.

<a id="setenta-e-cinco-por-cento"></a>

## 75%: cortar consumo

1. Reduza os tetos da produção por env (`QUOTA_QUESTIONS_GLOBAL_DAILY`,
   `QUOTA_STREAM_SECONDS_DAILY` em `infra/vercel/env.production.json`, aplicados no próximo deploy)
   ou, se não der para esperar, ligue o kill switch à mão no staging (abaixo): o staging divide a
   mesma cota.
2. Confira se a conta da janela de 30 dias vai cair sozinha (pico antigo saindo da janela) ou se o
   consumo diário continua alto. Se continuar, o 85% chega e o job age. Com cobertura baixa no
   resumo, não espere o job: a estimativa pode estar atrasada em relação à Vercel → Usage.

## 85%: kill switch de geração (automático)

O que o job fez em cada projeto (`tekoia-staging` primeiro, depois `tekoia`):

1. `LLM_KILL_SWITCH=true` no ambiente Production (`POST /v10/projects/{id}/env?upsert=true`). A
   variável fica fora dos `infra/vercel/env.*.json` de propósito: o sync de env de um deploy
   seguinte não a desliga.
2. Redeploy da deployment para onde o domínio canônico aponta (`POST /v13/deployments` com o
   `deploymentId` dela, o mesmo do `vercel redeploy`), espera do `READY` e `promote` se o domínio
   ainda não apontar para a nova. Env var só vale em deployment nova.

Com o kill switch ligado, cache hit responde e cache miss dá 503 `service_paused`: a UI mostra a
pausa e nenhuma pergunta gasta Function de stream nem provedor de LLM. Login, histórico e o
estático continuam.

**Conferir** (faça sempre, inclusive depois do exercício): uma pergunta nova no domínio de
produção do projeto responde 503 `service_paused`. Se a pergunta ainda gera resposta, o redeploy
reaproveitou a configuração antiga (a Vercel avisa que o redeploy de uma deployment `--prebuilt`
reaproveita o output pronto): rode o deploy normal do projeto (o workflow de deploy cria uma
deployment nova do tarball atestado, que lê as env vars do projeto) e confira de novo.

## 95%: lockdown (automático)

Antes do kill switch, o job chama `node scripts/vercel-firewall.ts --env <env> --lockdown on` nos
dois projetos: a regra 1 do WAF (`infra/vercel/firewall-rules.json`) passa a redirecionar (307,
temporário) para a página de aviso `/aviso/` tudo exceto `/healthz`, `/api/healthz`, a própria
página, `/_next/static/*` (CSS, fontes e JS dela) e `/favicon.ico`. O redirect sai da borda, sem
invocar a Function; a página é estática, nos dois idiomas, e diz que o Tekó está pausado até a cota
se renovar. É temporário para que o navegador não o guarde depois do `--lockdown off`.

Conferir (o `-w` mostra o código e o destino do redirect):

```bash
for path in /healthz /aviso/ /pt-BR/ /api/v1/coverage; do
  curl -sS -o /dev/null -w "$path %{http_code} %{redirect_url}\n" "https://tekoia.vercel.app$path"
done
```

Esperado: `/healthz` e `/aviso/` com 200; `/pt-BR/` e `/api/v1/coverage` com 307 para
`https://tekoia.vercel.app/aviso/`.

<a id="ligar-a-mao"></a>

## Ligar à mão

Actions → Ops → Run workflow, a partir de `main`:

| Input                | Valor                                                   |
| -------------------- | ------------------------------------------------------- |
| `job`                | `vercel-usage`                                          |
| `dry_run`            | `true` para ver o plano; `false` para agir              |
| `kill_switch`        | `0.85` (só o kill switch) ou `0.95` (também o lockdown) |
| `kill_switch_target` | `staging` ou `production`                               |

O modo de exercício não lê o uso nem envia métricas; age só no projeto escolhido. Equivale a
`node scripts/vercel-usage.ts --force-threshold 0.85 --only staging` com o token do environment
`ops` (rode só pelo Actions: o script publica de verdade).

<a id="desligar"></a>

## Desligar (volta manual)

Só depois que `teko_vercel_usage_ratio` de todos os recursos ficar **abaixo de 0,85** na janela de
30 dias (e a Vercel → Usage confirmar, inclusive para os recursos sem fonte no Hobby): senão a
execução seguinte, em até 10 minutos, liga tudo de novo.

1. Actions → Ops → Run workflow: `job: vercel-usage`, `kill_switch: release`,
   `kill_switch_target: staging`, `dry_run: false`. Repita com `production`.
2. O job grava `LLM_KILL_SWITCH=false`, redeploya a deployment de produção atual e chama
   `vercel-firewall.ts --lockdown off` (a regra 1 volta ao normal: nega só `/api/*` desconhecido).
3. Confira: uma pergunta nova responde; `/pt-BR/` e `/api/v1/coverage` respondem 200, sem o 307
   para `/aviso/`.

Sem o Actions (token vencido, por exemplo), pela CLI com o seu login: `printf 'false' | vercel env
add LLM_KILL_SWITCH production --force` no projeto linkado, `vercel redeploy <url de produção>
--target production` e, se o lockdown estiver ligado, a regra 1 original de
`infra/vercel/firewall-rules.json` pelo dashboard (Firewall → regra 1 → editar).

<a id="exercicio-no-staging"></a>

## Exercício no staging (DoD da F7)

1. `job: vercel-usage`, `kill_switch: 0.85`, `kill_switch_target: staging`, `dry_run: true`: o
   resumo mostra "gravar LLM_KILL_SWITCH=true" e "redeploy da deployment de produção ...".
2. O mesmo com `dry_run: false`. Conferir a pergunta nova com 503 `service_paused` em
   `https://tekoia-staging.vercel.app`.
3. `kill_switch: 0.95`, `dry_run: false`. Conferir em `https://tekoia-staging.vercel.app`, com o
   laço de `curl` da seção 95% no host do staging: `/healthz` 200, `/aviso/` 200, `/pt-BR/` e
   `/api/v1/coverage` com 307 para `/aviso/`. No navegador, `/pt-BR/` leva à página de aviso,
   legível e nos dois idiomas.
4. `kill_switch: release`, `dry_run: false`. Conferir que perguntas, `/pt-BR/` e `/api/v1/coverage`
   voltaram, sem o 307.

| Data | Run do 0.85 | 503 `service_paused` | Run do 0.95 | `/healthz` e `/aviso/` 200, `/pt-BR/` e `/api` 307 | Run do release | Observações |
| ---- | ----------- | -------------------- | ----------- | -------------------------------------------------- | -------------- | ----------- |
|      |             |                      |             |                                                    |                |             |

## O que nunca fazer

- Migrar para o Pro, cadastrar cartão ou abrir uma segunda conta (viola a política de uso justo).
- Gerar carga contra a Vercel para testar a guarda: o exercício usa o `--force-threshold`.
