# Design

## Context

O fluxo alvo está em `infra/vercel/README.md` ("Como o deploy acontece") e em
`docs/architecture/ci-cd-e-ambientes.md` ("Deploy e rollback"). O spike F1 (b) provou o build pelo
tsdown, o tarball atestado, o `vercel deploy --prebuilt --prod --skip-domain`, o `vercel curl` com o
bypass e o `promote`. Os environments já existem: `staging` (ref `main`), `production` (só tag
`v*`, revisor), `release-rehearsal` (só tag `v*`). A F9 traz o `release.yml` completo.

Documentação consultada no Context7 (IDs):

- `/websites/vercel`: `vercel deploy --prebuilt --archive=tgz` e `--meta`; `vercel promote <url>
  --timeout`; `vercel rollback` (no Hobby, só a anterior; depois dele, a atribuição automática dos
  domínios de produção fica desligada até um `promote`); `vercel redeploy <url>` (`--no-wait`);
  `GET /v13/deployments/{idOrUrl}` (`url`, `meta`); `x-vercel-protection-bypass`.
- `/websites/github_en_actions`: `environment` com `deployment: false` (acesso às variáveis sem
  objeto de deployment; revisor obrigatório continua valendo); `actions/attest` com `subject-path` e
  `sbom-path`; `gh attestation verify --predicate-type https://spdx.dev/Document/v2.3`.
- `/neondatabase/website`: `POST /projects/{id}/branches` com `endpoints: [{type: read_write}]`,
  `GET /projects/{id}/branches/{branch_id}` (`current_state`), `GET /projects/{id}/connection_uri`
  (`branch_id`, `database_name`, `role_name`) e `DELETE` do branch.
- `/anchore/grype`: varredura de SBOM (`sbom:`); entradas das actions `anchore/sbom-action` v0.24.3
  e `anchore/scan-action` v7.4.2 conferidas no `action.yml` de cada uma (fixadas por SHA).
- `/actions/create-github-app-token` (já registrado em `add-docling-pdf-extraction`).

## Goals / Non-Goals

**Goals:** um deploy por ambiente que publica exatamente o tarball atestado, com migrações e
configuração do projeto aplicadas antes; produção só a partir de commit verde no staging; rollback
automático depois do promote; redeploy para rotação; ensaio das migrações num branch efêmero.

**Non-Goals:** o `scripts/smoke.ts` completo e o system test (`add-smoke-tests`); o guarda de uso e
o `weekly-maintenance` (`add-usage-guard`); o `release.yml` completo, o release imutável e o
`promote-corpus` (F9).

## Decisions

- **Dois jobs no environment, build sem segredo.** O build lê só as variáveis `NEXT_PUBLIC_*` (o
  environment entra com `deployment: false`) e não recebe nenhum segredo: dependências do build não
  veem `VERCEL_TOKEN`, URL de migração nem a chave do PostHog. O upload dos source maps vai para o
  job `deploy`, a partir de um artifact de um dia. Na produção, isso custa duas aprovações (build e
  deploy); juntar os dois economizaria uma ao preço de expor os segredos ao build.
- **Verificação antes de qualquer escrita.** O `deploy` confere o sha256 do artifact contra a saída
  do build e roda `gh attestation verify` (proveniência e SBOM, com `--signer-workflow` do
  `deploy.yml` e `--source-digest` do commit) antes do migrate.
- **Ordem do deploy.** verify → migrate (+ extensões) → env sync → WAF → source maps → deploy →
  smoke da URL única → promote → smoke canônico. Migração vem antes (expand/contract: o código em
  produção continua compatível). Falha depois do promote → `vercel rollback` com a seção ROLLBACK no
  resumo; antes do promote nada vai ao ar (`--skip-domain`).
- **Smoke por contrato.** `deploy-smoke.sh` chama o `scripts/smoke.ts` (contrato da
  `add-smoke-tests`) quando ele existe no commit; senão, `::warning` e o mínimo: `/healthz` com
  `status: ok` e o `gitSha` esperado (o canônico repete por até 2 min por causa da propagação do
  promote). O bypass vai num arquivo de header, fora da linha de comando.
- **Produção só depois do staging.** `staging-verified.sh`: o último run concluído do `deploy.yml`
  em `main` para o SHA precisa ser verde. Roda no `release.yml` antes da tag e de novo no `plan` da
  produção. O `release.yml` mínimo (ADR 0038) cria a tag pela App; o push da tag dispara o deploy.
- **Redeploy.** `phase: redeploy` lê `targets.production` do projeto, faz `vercel redeploy` dessa
  deployment (o mesmo output prebuilt), roda o env sync, o smoke com o `meta.gitSha` original, o
  promote e o smoke canônico; sem build, migrate nem WAF.
- **Versão.** Produção: a da tag (`APP_VERSION`, release `teko@X.Y.Z`). Staging: a do `package.json`
  com o SHA curto (`0.0.0-abc1234`, release `teko@abc1234`), como o `errorTrackingRelease` da API.
- **Egress em block com hosts exatos** em todos os jobs com passos (o `audit.yml` chamado mantém o
  dele). Vercel, Neon e PostHog só no egress do `deploy`.
- **neon-rehearsal** no environment `release-rehearsal` com `deployment: false`; o branch se chama
  `rehearsal-<run>-<tentativa>` e é apagado num passo `if: always()`. A URL do owner é mascarada e
  vai para o `GITHUB_ENV` do próprio job. Sem `NEON_API_KEY_PROD` ou `NEON_PROD_PROJECT_ID`, aviso e
  verde (o environment ainda está vazio).

## Risks / Trade-offs

- A allowlist de egress do build e do deploy nunca rodou: um host esquecido derruba o primeiro run
  (o harden-runner mostra o host bloqueado no resumo) e entra por PR.
- Logs de runtime não vão para o log do Actions em falha (podem ter dados de uso); só o `vercel
  inspect`.
- O artifact do tarball de produção dura 90 dias até o release imutável da F9.
