---

status: accepted
date: 2026-11-18
decision-makers: Rafael Daily Santos Martins
---

# 0038 — Produção na F7 por um `release.yml` mínimo, antes do fluxo completo da F9

## Contexto e problema

A [ADR 0033](0033-trunk-based.md) põe a produção atrás de uma tag `v*`, criada só pela App
`teko-release-bot`, e descreve um `release.yml` completo: versão calculada pelo git-cliff, PR de
release com o `CHANGELOG.md`, o job `release-gate` (neon-rehearsal, evals completas, e2e, perf, ZAP,
`staging-verified`) e o release imutável com o tarball atestado. Esse fluxo é da F9. A F7 precisa
de deploys de produção de verdade (o DoD pede stream no domínio de produção, rollback, `promote` de
uma deployment antiga e o tarball de um release), e as peças da F9 (evals completas, ZAP, changelog)
ainda não existem. Como a F7 chega à produção sem antecipar a F9 nem abrir mão das fronteiras da
ADR 0033?

## Fatores de decisão

- A tag `v*` continua a única fronteira de produção, criada só pela App (ruleset `release-tags`),
  com o revisor do environment `production`.
- Produção só recebe um commit que já passou pelo staging (deploy e smoke verdes para o mesmo SHA).
- Nada de trabalho descartável: o que a F7 cria precisa servir à F9.

## Opções consideradas

- **`release.yml` mínimo**: `workflow_dispatch` com a versão, que confere o staging e cria a tag.
- Criar a tag à mão (`gh api` com o token da App na máquina do mantenedor).
- Antecipar o `release.yml` completo da F9 para a F7.

## Decisão

Opção escolhida: **`release.yml` mínimo**.

- `release.yml` só tem `workflow_dispatch`, em `main`, com o input `version` (SemVer sem `v`, com
  pré-release opcional, ex.: `0.1.0-rc.1`). Ele valida o formato, recusa uma tag que já existe,
  exige o último deploy de staging do SHA atual de `main` verde
  (`.github/scripts/staging-verified.sh`) e cria a tag leve `v<versão>` nesse SHA com o token da App
  (`actions/create-github-app-token`, `permission-contents: write`).
- O push da tag dispara o `deploy.yml` de produção, que repete a checagem de staging no job `plan`
  (defesa em profundidade contra uma tag criada por outro caminho), roda o `neon-rehearsal` e pede o
  revisor duas vezes: no `build` (que lê as variáveis públicas do environment, sem nenhum segredo) e
  no `deploy`.
- A versão de produção vem da tag (`APP_VERSION` no `.vc-config.json` e o release `teko@X.Y.Z` do
  PostHog), sem o PR que sincroniza os `package.json`; até a F9 eles continuam em `0.0.0`.
- O tarball de produção fica como artifact de 90 dias (o asset do release imutável chega na F9).
- A F9 acrescenta, sem desfazer nada daqui: o git-cliff e o PR de release, o `release-gate` como job
  (que reaproveita o `neon-rehearsal.yml` e o `staging-verified.sh`), o release imutável e o
  `promote-corpus`.

### Consequências

- Boa: a produção da F7 passa pelas mesmas fronteiras da ADR 0033 (tag só pela App, staging verde,
  revisor), e as peças novas (`staging-verified.sh`, `neon-rehearsal.yml`, `deploy.yml`) são as que
  o `release-gate` da F9 usa.
- Ruim: até a F9, a produção não tem evals completas, ZAP nem changelog antes da tag; o mantenedor
  decide o número da versão.
- Ruim: o `deploy.yml` de produção pede duas aprovações (build e deploy).

### Confirmação

- `bash .github/scripts/ci-config.test.sh`: o `release.yml` só tem dispatch em `main`, valida o
  SemVer, roda o `staging-verified.sh` antes de criar a tag e usa o token da App.
- O primeiro release da F7 (`0.1.0-rc.1` ou o que o mantenedor escolher) cria a tag e dispara o
  deploy de produção.

## Prós e contras das opções

### Tag criada à mão

- Bom: nenhum workflow novo.
- Ruim: a chave privada da App sairia do GitHub para a máquina do mantenedor, e a checagem do
  staging dependeria de disciplina.

### `release.yml` completo já na F7

- Bom: um fluxo só, sem etapa intermediária.
- Ruim: depende de peças que só existem na F8 e na F9 (evals de geração, ZAP, changelog).

## Mais informações

- Complementa a [ADR 0033](0033-trunk-based.md) (o `release.yml` dela chega na F9) e a
  [ADR 0017](0017-vercel-build-output-tsdown.md) (o deploy `--prebuilt` do tarball atestado).
- Mudança OpenSpec `add-deploy-pipelines`; runbooks [`deploy.md`](../runbooks/deploy.md) e
  [`rollback.md`](../runbooks/rollback.md).
- Fontes Context7 consultadas em 2026-11-18: `/websites/github_en_actions` (environment com
  `deployment: false` ainda pede o revisor; atestações de SBOM com `actions/attest`) e
  `/actions/create-github-app-token` (registrado na mudança `add-docling-pdf-extraction`).
