# Runbook: projeto Vercel pausado (503 `DEPLOYMENT_PAUSED` ou 402 `DEPLOYMENT_DISABLED`)

Cobre o alerta `teko-deployment-paused` (`infra/grafana/alerts.json`): o Synthetic Monitoring viu
503 ou 402 no `/healthz`. Na Vercel, o `/healthz` só devolve 503 com o projeto pausado ou numa
queda da plataforma, e 402 quando a conta Hobby passou de uma cota e a Vercel desativou as
deployments da conta. Sem ciclo de cobrança, "na maioria dos casos" o recurso estourado fica
bloqueado até passarem cerca de 30 dias, e **a retomada é manual**
([contas e cotas](../architecture/contas-e-cotas.md#vercel-hobby)).

<a id="diagnostico"></a>

## Diagnóstico

1. `curl -sS -i https://tekoia.vercel.app/healthz`:
   - **402** `Payment Required` com `x-vercel-error: DEPLOYMENT_DISABLED`: a conta Hobby passou de
     uma cota e a Vercel desativou todas as deployments dos dois projetos (foi o caso de
     2026-11-25). O estático também responde 402.
   - **503** com `x-vercel-error: DEPLOYMENT_PAUSED`: o projeto foi pausado (pela cota ou por
     `POST /v1/projects/{id}/pause`); a pausa vale para o projeto inteiro, estático incluído.
   - Outro código ou erro de rede é queda: [ops-alerts.md](ops-alerts.md#check-sintetico-falhando).
2. Vercel → Usage: qual recurso passou da cota; Vercel → projeto: o aviso de pausa ou de
   desativação. Confira o e-mail da Vercel na conta do mantenedor.
3. Os dois projetos? A cota é da conta: o staging costuma cair junto
   (`https://tekoia-staging.vercel.app/healthz`).
4. [vercel-status.com](https://www.vercel-status.com/) sem incidente confirma que é a cota.

A guarda de uso (`vercel-usage` do `ops.yml`) deveria ter ligado o kill switch em 85% e o lockdown
em 95% ([budget-kill-switch.md](budget-kill-switch.md)). Se a pausa chegou mesmo assim, registre
por quê (pico entre duas leituras, cobertura baixa, job vermelho, recurso sem fonte no Hobby) e
corrija antes de retomar.

<a id="enquanto-pausado"></a>

## Enquanto a Vercel estiver pausada

O Tekó fica fora do ar (web e API, na mesma origem) até a Vercel liberar o recurso. Não há o que
acelerar:

1. **Avisar.** Banner no README e uma linha em `docs/status.md` (por PR) com o motivo e a previsão
   de volta (cerca de 30 dias a partir do estouro, segundo a Vercel → Usage).
2. **Esperar o ciclo.** Acompanhe Vercel → Usage: a retomada só funciona com a janela do recurso
   abaixo da cota.
3. **Evitar consumo novo.** Nada de deploy, carga ou teste contra os projetos pausados; o staging
   divide a mesma cota da conta.
4. **Nunca** migrar para o Pro, cadastrar cartão nem abrir outra conta (viola a política de uso
   justo e os Termos).

<a id="retomar"></a>

## Retomar o projeto

Quando a Vercel liberar o recurso:

1. **503 (`DEPLOYMENT_PAUSED`):** `vercel project resume tekoia` (alias `unpause`; Vercel CLI de
   `tools/vercel-cli` com o seu login) ou
   `POST https://api.vercel.com/v1/projects/prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as/unpause?teamId=<time>`.
   O mesmo para o `tekoia-staging` (`prj_rgXwv6zcTTb1UPU1qkEMrAWu6hY5`).
   **402 (`DEPLOYMENT_DISABLED`):** a desativação é da conta; siga o que a Vercel → Usage e o
   e-mail da Vercel indicarem (esperar a janela de 30 dias ou falar com o suporte) e, se os projetos
   aparecerem pausados depois disso, use o `resume` acima.
2. `/healthz` 200 nos dois domínios e o smoke da produção.
3. O kill switch e o lockdown continuam como o `vercel-usage` deixou: desligue só com o uso abaixo de
   85% ([budget-kill-switch.md](budget-kill-switch.md#desligar)). Ligue o kill switch à mão antes de
   reabrir se a causa da pausa ainda não foi corrigida.
4. Confira que o `vercel-usage` voltou a ficar verde (Actions → Ops) e que o resumo mostra a
   cobertura subindo: o estado recomeça a contar a partir da retomada.
5. Tire o banner do README e atualize o `docs/status.md`.

<a id="registro"></a>

## Registro

| Data da pausa | Recurso estourado      | Por que a guarda não segurou                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Data da retomada | Observações                                                         |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| 2026-11-25    | Fluid Active CPU (4 h) | A guarda nunca mediu nada: o `vercel billing usage` que ela lia não funciona no Hobby (404 `costs_not_found`, sem assinatura), e todos os runs agendados do `vercel-usage` desde 2026-11-19 ficaram vermelhos. O `teko-ops-job-stale` não disparou porque a série de sucesso nunca existiu (NoData = `Normal`), e o `teko-deployment-paused` só olhava 503. Corrigido na mudança `fix-vercel-usage-hobby` (fonte `vercel metrics` a cada 10 min, alerta com ausência e 6 h, 402 no alerta de pausa). | pendente         | 402 `DEPLOYMENT_DISABLED` nos dois projetos, inclusive no estático. |
