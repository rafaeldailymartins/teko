# Runbook: rollback de deploy na Vercel

Para voltar o código (estático e Function) de staging ou produção a uma deployment anterior. O
corpus tem rollback próprio ([rollback do corpus](rollback-corpus.md)); migrações não voltam
(expand/contract: o código anterior continua compatível com o schema novo).

## Automático

O `deploy.yml` volta o domínio sozinho quando algo falha **depois** do `vercel promote` (smoke do
domínio canônico): antes do promote ele lê a deployment que está no domínio
(`targets.production`) e, na falha, a promove de novo e confere o `gitSha` do `/healthz`. Só sem
deployment anterior conhecida ele cai no `vercel rollback`. O resumo do run mostra a seção
**ROLLBACK**, com o tempo da volta. Falha antes do promote não precisa de rollback: a deployment
nova nunca recebeu o domínio (`--skip-domain`). A falha do system test do staging não volta o
domínio (ele roda em outro job).

**Exercício:** Actions → **Deploy** → Run workflow em `main` com `simulate_failure: true` (só
staging; a produção recusa). O deploy segue até o smoke canônico verde, falha de propósito e o
rollback precisa devolver o domínio à deployment anterior.

## Manual

Na máquina do mantenedor, com o Vercel CLI de `tools/vercel-cli` e o escopo do projeto nas
variáveis `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` do ambiente (o `vercel rollback` não aceita
`--project`). Publica de verdade.

**Prefira o `vercel promote` da deployment certa.** O `vercel rollback` escolhe a deployment de
produção criada antes da atual, não a que estava no ar: no exercício da F7 (2026-11-18), com a
deployment do `rc.2` promovida à mão, ele "voltou" para ela mesma, e uma deployment que parou no
smoke (criada com `--prod --skip-domain`) também conta como de produção.

1. **Para uma deployment de produção específica** (a anterior ou uma mais antiga): ache a URL em
   `vercel list --prod` (ou pelo `meta.gitSha`: `vercel list --meta gitSha=<sha>`) e promova
   (cerca de 2 s no exercício):

   ```bash
   vercel promote https://<deployment>.vercel.app --timeout=5m; echo "exit=$?"
   ```

2. **`vercel rollback`** só quando a anterior na ordem de criação é a certa:

   ```bash
   vercel rollback --timeout=5m; echo "exit=$?"
   ```

3. **Tarball de um release** (deployment antiga já removida): [redeploy do tarball](deploy.md#redeploy-do-tarball-de-um-release)
   com `gh attestation verify` e `vercel deploy --prebuilt`, depois `vercel promote`.

Depois de qualquer um, confira o domínio canônico:
`curl -sS https://tekoia.vercel.app/healthz` (ou `tekoia-staging`) deve devolver o `gitSha` da
deployment escolhida. Logo depois do promote, o domínio ainda pode servir a anterior por alguns
segundos.

## O que fica para trás

- **Atribuição automática do domínio desligada.** Depois de um `vercel rollback`, a Vercel deixa de
  atribuir o domínio de produção a deployments novas até um `vercel promote` explícito. O
  `deploy.yml` sempre promove explicitamente (`--skip-domain` + `promote`), então o próximo deploy
  verde religa; até lá, nenhuma deployment nova vai ao ar sozinha.
- **Env vars não voltam.** O rollback troca o código, não as env vars do projeto: uma Sensitive ou
  Config alterada depois da deployment antiga continua valendo. Se a causa foi uma env var, corrija
  a env var (Config: PR em `infra/vercel/env.<env>.json`; Sensitive: o mantenedor) e faça um
  redeploy ([rotação](deploy.md#rotação-de-sensitive-redeploy)).
- **Migrações não voltam.** Se a deployment antiga não roda no schema atual, a saída é uma correção
  para a frente, nunca um rollback de banco.
- **O WAF não volta.** As regras do `firewall-rules.json` aplicadas pelo deploy ficam; um lockdown
  ativo também.

## Depois

Corrija em `main` com um PR comum. O deploy de staging do merge e, para a produção, um release novo
(`release.yml`) religam o fluxo normal.
