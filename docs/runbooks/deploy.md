# Runbook: deploy de staging e produção

O deploy é sempre o `deploy.yml` (F7; [ADR 0017](../adr/0017-vercel-build-output-tsdown.md),
[ADR 0029](../adr/0029-web-e-api-na-mesma-origem.md), [ADR 0033](../adr/0033-trunk-based.md) e
[ADR 0038](../adr/0038-release-minimo-da-f7.md)). Nunca há deploy local: as CLIs usam o login
salvo e publicam de verdade. Desenho em
[CI/CD e ambientes](../architecture/ci-cd-e-ambientes.md#deploy-e-rollback); configuração dos
projetos em [`infra/vercel/README.md`](../../infra/vercel/README.md).

## Fluxo

| Gatilho                              | Ambiente | Projeto          | Environment do GitHub              |
| ------------------------------------ | -------- | ---------------- | ---------------------------------- |
| push em `main` (todo PR que entra)   | staging  | `tekoia-staging` | `staging`                          |
| tag `v*` (criada pelo `release.yml`) | produção | `tekoia`         | `production` (revisor: mantenedor) |
| `workflow_dispatch` (`phase`)        | o do ref | o do ref         | o do ref                           |

Jobs: `plan` → `audit` → `build` → `neon-rehearsal` (só produção) → `deploy`.

1. **plan**: ambiente, versão (`X.Y.Z` da tag; no staging, a versão do `package.json` com o SHA
   curto) e release do PostHog (`teko@X.Y.Z` ou `teko@<sha7>`). Na produção, exige o último deploy
   de staging do mesmo SHA verde (`.github/scripts/staging-verified.sh`).
2. **audit**: `pnpm audit --prod` e osv-scanner no commit exato (`audit.yml`).
3. **build** (sem segredo; na produção, pede o revisor por ler as variáveis do environment): build
   da API e do web, chunk ids do PostHog e o pós-build de novo, `pnpm deploy --prod`,
   `build-vercel-output.ts` (com `GIT_SHA` e `APP_VERSION` no `.vc-config.json`),
   `pack-vercel-output.ts` (gitleaks, tarball determinístico e sha256), SBOM (syft), Grype
   (high ou acima com correção reprova), atestações de proveniência e de SBOM e os artifacts
   `vercel-output-<env>` (30 dias no staging, 90 na produção) e `sourcemaps-<env>` (1 dia).
4. **neon-rehearsal** (só produção): `drizzle-kit migrate` num branch efêmero do `teko-prod`,
   apagado sempre; sem a API key no environment `release-rehearsal`, avisa e passa.
5. **deploy** (revisor na produção): `gh attestation verify` do tarball (proveniência e SBOM, pelo
   `deploy.yml` e pelo SHA), `drizzle-kit migrate` na URL direta do owner com a checagem de
   extensões, na produção o `promote-corpus` (`cli snapshot promote --lock
   corpus/corpus.lock.json`: o snapshot do lock do commit, conferido pelo sha256 do manifesto; com
   a produção já nele ou à frente dele, nada muda), `vercel-env-sync.ts`, `vercel-firewall.ts` (mantém um lockdown ativo), upload dos
   source maps, `vercel deploy --prebuilt --prod --skip-domain --archive=tgz --meta
   artifactSha256=… --meta gitSha=…`, smoke da URL única (bypass de automação), `vercel promote`,
   smoke do domínio canônico. Falha depois do promote: `vercel rollback` automático, com o aviso no
   resumo do run.

O system test do staging entra depois do smoke canônico (ponto marcado no `deploy.yml`).

## Produção (release)

1. Confira que o último deploy de staging de `main` está verde.
2. Actions → **Release** → Run workflow em `main`, com a versão sem `v` (ex.: `0.1.0-rc.1`). O
   workflow valida o SemVer, recusa tag existente, confere o staging e cria a tag pela App.
3. O push da tag dispara o **Deploy** de produção: aprove o `build` e depois o `deploy` no
   environment `production`.
4. Confira o resumo: atestações verificadas, migrações, corpus (promovido, já na versão do lock ou
   à frente dela), env sync, WAF, URL da deployment e os dois smokes.

Antes do release, confira que o `corpus/corpus.lock.json` de `main` foi exportado com a última
migração (`snapshot.migration` igual ao hash da migração mais nova): se uma migração entrou depois
do último PR do lock, rode a ingestão completa no staging e faça o merge do PR do lock antes, ou o
`promote-corpus` recusa o snapshot.

## Rotação de Sensitive (redeploy)

Env var só vale em deployment nova. Para trocar uma Sensitive sem novo build:

1. O mantenedor grava o valor novo (`vercel env add NOME production --sensitive`, valor pelo stdin;
   antes, `vercel env rm NOME production --yes`).
2. Actions → **Deploy** → Run workflow com `phase: redeploy`, no ref do ambiente (`main` para o
   staging; a tag `v*` em produção, por exemplo a última publicada).
3. O job lê a deployment de produção atual (`targets.production` do projeto), roda o env sync,
   `vercel redeploy` dela (o mesmo output prebuilt atestado), o smoke da URL nova com o `gitSha`
   da deployment original, o `vercel promote` e o smoke canônico; falha depois do promote faz
   rollback. Migrações, firewall e build não rodam.

## Redeploy do tarball de um release

A âncora de longo prazo é o tarball atestado (artifact `vercel-output-production` do run da tag;
na F9, o asset do release imutável). Para publicar de novo um release antigo, numa máquina com o
`gh` autenticado e o Vercel CLI de `tools/vercel-cli` (com o mantenedor, porque publica de verdade):

```bash
TMPD="$(mktemp -d)"; echo "TMPD=$TMPD"
gh run download <run-id> --repo rafaeldailymartins/teko --name vercel-output-production --dir "$TMPD"; echo "exit=$?"
(cd "$TMPD" && sha256sum --check --strict output.tgz.sha256); echo "exit=$?"
gh attestation verify "$TMPD/output.tgz" --repo rafaeldailymartins/teko \
  --signer-workflow rafaeldailymartins/teko/.github/workflows/deploy.yml; echo "exit=$?"
mkdir -p "$TMPD/deploy/.vercel" && tar -xzf "$TMPD/output.tgz" -C "$TMPD/deploy/.vercel"
cd "$TMPD/deploy"
VERCEL_ORG_ID=<time> VERCEL_PROJECT_ID=prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as \
  vercel deploy --prebuilt --prod --skip-domain --archive=tgz \
  --meta artifactSha256=<sha256 do .sha256> --meta gitSha=<sha da tag>
```

Depois: smoke da URL única (`bash .github/scripts/deploy-smoke.sh production deployment <url>
<sha>` com `VERCEL_AUTOMATION_BYPASS_SECRET` no ambiente) e `vercel promote <url>`. A atestação
precisa bater com a `meta.artifactSha256` da deployment (`vercel inspect <url>`). Env vars e
migrações são as de hoje, não as do release: confira se o código antigo ainda é compatível com o
schema (expand/contract) antes.

## Quando o deploy falha

| Onde                      | O que fazer                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `plan` (staging-verified) | o commit não passou pelo staging: espere o deploy de staging ou corrija em `main` e faça outro release         |
| `audit` ou Grype          | advisory novo: override no `pnpm-workspace.yaml` ou subida da dependência, num PR                              |
| `build` (pack)            | gitleaks ou env var com valor no output: nada foi publicado; ache a origem no build                            |
| `deploy` (verificação)    | atestação ou sha256 diferente: não publique; investigue o artifact                                             |
| `deploy` (migrate)        | migração quebrada: corrija com uma migração nova (expand/contract); nada foi publicado                         |
| `promote-corpus` (recusa) | migração ou sha256 diferente do lock, ou snapshot ausente: reexporte no staging e faça o merge do PR do lock   |
| `promote-corpus` (aviso)  | produção à frente do lock após um [rollback de corpus](rollback-corpus.md): nada promovido, o deploy segue     |
| `deploy` (env sync)       | falta Sensitive: o mantenedor grava e roda de novo (re-run do job)                                             |
| `deploy` (firewall)       | firewall desligado ou regra repetida no projeto: corrija no dashboard e rode de novo                           |
| smoke da URL única        | a deployment ficou sem domínio; nada a desfazer. Veja o `vercel inspect` no log e os logs no dashboard         |
| depois do promote         | o job já fez `vercel rollback`; siga o [runbook de rollback](rollback.md) para religar a atribuição do domínio |
