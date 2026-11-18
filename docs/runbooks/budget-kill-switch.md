# Runbook: guarda de uso da Vercel (kill switch e lockdown)

Cobre os alertas `teko-vercel-usage-50` e `teko-vercel-usage-75` (`infra/grafana/alerts.json`) e o
que o job `vercel-usage` do `ops.yml` faz sozinho em 85% e 95%. A conta Hobby soma `tekoia` e
`tekoia-staging`, não compra uso extra e, ao estourar uma cota, pausa os projetos por cerca de
30 dias ([contas e cotas](../architecture/contas-e-cotas.md#vercel-hobby);
[vercel-paused.md](vercel-paused.md)).

## Onde ver

- Dashboard **Tekó · Vercel Hobby**: `teko_vercel_usage_ratio{resource}`, uso dos últimos 30 dias
  sobre a cota mensal, por recurso (`provisioned_memory`, `active_cpu`, `function_invocations`,
  `fast_origin_transfer`, `fast_data_transfer`, `cdn_requests` e os de imagem).
- Resumo do job `vercel-usage` (Actions → Ops): a tabela de uso, cota e porcentagem e o que o job
  fez em cada projeto.
- Vercel → Usage (a fonte do `vercel billing usage --since 30d --json` que o job lê). As cotas ficam
  fixadas em `scripts/vercel-usage.ts` (`HOBBY_QUOTAS`), porque a saída traz o uso e não o saldo.

## Limiares

| Uso (qualquer recurso) | O que acontece                                                                      | Quem age                             |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 50%                    | e-mail (`teko-vercel-usage-50`)                                                     | mantenedor: investigar               |
| 75%                    | e-mail (`teko-vercel-usage-75`)                                                     | mantenedor: cortar consumo           |
| **85%**                | `LLM_KILL_SWITCH=true` nos dois projetos + redeploy da deployment de produção atual | `vercel-usage`, sozinho              |
| **95%**                | além disso, lockdown: a regra 1 do WAF manda tudo (menos `/healthz`) para `/aviso/` | `vercel-usage`, sozinho              |
| 100%                   | a Vercel pausa os projetos (503 `DEPLOYMENT_PAUSED`)                                | [vercel-paused.md](vercel-paused.md) |

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
   consumo diário continua alto. Se continuar, o 85% chega e o job age.

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
30 dias: senão a execução diária seguinte liga tudo de novo.

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
