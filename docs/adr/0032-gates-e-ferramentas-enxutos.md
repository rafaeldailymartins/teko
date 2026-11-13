---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0032 — Gates e ferramentas de CI enxutos

## Contexto e problema

Na revisão de arquitetura de 2026-11-12 (antes da F4), o PR gate tinha mediana de 5,8 min e p90 de
9 min. Nos últimos cinco runs verdes do `pr-gate.yml`, o caminho crítico era o
`mutation / stryker` (262 a 432 s), e logo atrás vinha o `ci / sonar`, que começava depois de
`test`, `integration` e `python` e esperava o quality gate (88 a 122 s). Um PR só de documentação
(#60) levou 3 min, quase todo esperando o Sonar.

Além do tempo, três gates reprovavam PRs por motivos alheios à mudança:

- o `pnpm audit` (no `ci.yml`) e o osv-scanner (no `security.yml`) rodavam em todo PR, inclusive
  de documentação, e um advisory novo publicado no meio do dia reprovava qualquer PR aberto;
- os uploads ao Codecov usavam `fail_ci_if_error: true`: uma queda do serviço reprovava o PR;
- o Sonar entrava no `ci-gate` pelo `sonar.qualitygate.wait`, de modo que uma fila lenta ou uma
  regra do "Sonar way" bloqueava o merge, sem que isso fosse um gate decidido pelo projeto.

E algumas ferramentas duplicavam outras: o `turbo boundaries` (o dependency-cruiser e o knip já
barram imports e dependências), o hook `commit-msg` do commitlint (o que chega a `develop` é o
título do PR, conferido pelo `pr-title`, e o DCO é conferido pelo `dco`), o `pip-audit` (o
osv-scanner audita o `uv.lock` inteiro) e o Steiger, que sai junto com o Feature-Sliced Design do
web. Os quatro `spike-*.yml` da F1 já tinham cumprido o papel.

Como deixar o PR gate rápido e reprovando só pelo que a mudança causa, sem perder os sinais?

## Fatores de decisão

- Mantenedor único: cada minuto de PR gate é tempo de espera dele.
- Um gate só reprova o PR pelo que o PR mudou.
- Nenhum serviço externo no caminho do merge, além do GitHub.
- Os checks exigidos pelos rulesets (`ci-gate`, `Analyze (actions)`,
  `Analyze (javascript-typescript)`, `Analyze (python)`, `pr-title`, `gitflow-guard`, `dco`)
  continuam existindo até o mantenedor trocar os rulesets.

## Decisão

1. **Stryker só no noturno.** O `mutation.yml` sai do `pr-gate.yml` e fica com `schedule` e
   `workflow_dispatch`. No agendado, o job `changes` compara `github.sha` com o SHA do último run
   verde do próprio workflow em `develop` e pula o `stryker` se forem iguais (antes ele rodava com
   `--force` todo dia). O limite continua 70; um score abaixo deixa o run noturno vermelho.
2. **`pnpm audit` e osv-scanner fora do PR.** O `audit.yml` roda o
   `pnpm audit --prod --audit-level low` (e o dos CLIs isolados) e o osv-scanner sobre o
   `pnpm-lock.yaml` e o `uv.lock` (a única auditoria do Python) em push para `develop`/`main`, todo
   dia às 06:29 UTC, por `workflow_dispatch` e por `workflow_call`; os workflows de deploy da F7 o
   chamam antes de publicar. No PR ficam o `dependency-review` (só o que o PR introduz) e o
   `pnpm audit signatures`, no job `lint`.
3. **Sonar informativo e Codecov removido.** O job `sonar` vira o `sonar.yml`, chamado pelo
   `pr-gate.yml` depois do `ci` e fora dos `needs` do `ci-gate`, e pelo `ci.yml` em push para
   `develop`. Sem `sonar.qualitygate.wait` e com `continue-on-error`: o quality gate aparece pela
   decoração do App da SonarQube Cloud. O Codecov sai inteiro (`codecov.yml`, uploads,
   `id-token: write`, badge, trocado pelo de cobertura do SonarQube Cloud). O gate de cobertura é o
   threshold do Vitest.
   - `test`, `integration` e `python` continuam rodando em todo push: sem o lcov e o
     `coverage.xml`, a medida da branch no Sonar cai para 0% de código novo coberto. Em push ninguém
     espera, e o cache do Turbo faz os pacotes sem mudança saírem do cache.
   - A reescrita dos caminhos `SF:` do lcov continua (no `sonar.yml`): mover para o
     `projectRoot` do reporter do Vitest mexeria nos `vitest.config.ts` de três pacotes sem ganho.
4. **Ferramentas que saem:** `turbo boundaries` (e as tags dos `turbo.json` dos pacotes),
   Steiger/`lint:fsd` (e a exceção `chokidar@4.0.3`, a única de proveniência no workspace), o hook
   `commit-msg` e o pacote commitlint (tipos e escopos numa lista única,
   `.github/commit-types.json`, lida pelo `pr-title`; template de PR, labeler e CONTRIBUTING apontam
   para ela), o `pip-audit` e os `spike-*.yml`.
5. **`ci-gate` com `!cancelled()`** em vez de `always()`, dependendo de `affected`, `ci`,
   `security` e `perf`; só o `perf` pode pular.
6. **Escopo afetado mais fino.** Entre os workflows, só `ci.yml`, `pr-gate.yml` e `perf.yml`
   marcam tudo (no `affected.sh` e nos `globalDependencies` do `turbo.json`); `ingest.yml` e
   `source-watch.yml` marcam o grupo `ingest`; os demais (agendados, de higiene, `sonar.yml`,
   `audit.yml`) não marcam nada, porque o `lint` (actionlint e `ci-config.test.sh`) roda em todo PR
   com código. Grupo novo `docs` (`docs/**`, `openspec/**`, `**/*.md`, `.claude/**`) e chave
   derivada `code`: num PR só de documentação, o `lint` roda só Biome, lockfile e OpenSpec.
7. **`pnpm verify` e `pnpm verify:full`.** O `verify` é a camada rápida (lint, lockfile, sherif,
   OpenSpec, jscpd, knip, typecheck dos scripts e, pelo turbo, typecheck, dependency-cruiser,
   type-coverage e unitários); o `verify:full` soma testes dos scripts, integração, build, os testes
   de CI em shell (`verify:ci`), o Python (`verify:python`) e o audit (`verify:audit`). O pre-push
   do lefthook roda a parte por pacote do `verify` nos pacotes afetados desde `origin/develop`.
8. **`ci-config.test.sh` só com o que nenhum linter vê.** Saem o pin por SHA e o
   `persist-credentials`, que o zizmor já reprova (`unpinned-uses`, que desde a 1.20 exige hash em
   toda action, e `artipacked`). Ficam as invariantes de `ci-gate`, Sonar, audit, mutação,
   `ingest.yml`, `source-watch.yml` e dos harden-runner.
9. **CodeQL `actions`.** O zizmor e o actionlint já cobrem os workflows. Em 2026-11-13, com o aval
   do mantenedor, `Analyze (actions)` saiu dos checks exigidos do ruleset `checks-main` e a linha
   `actions` saiu da matriz do `codeql.yml`.

### Tempo esperado do PR gate

Com os tempos medidos nos runs de 2026-11-12:

| PR                         | Caminho crítico novo                                                         | Antes     |
| -------------------------- | ---------------------------------------------------------------------------- | --------- |
| API ou RAG                 | `affected` (~40 s) → `perf / sql-perf` (170–200 s) → `ci-gate`: ~4,0–4,5 min | 5,5–8 min |
| Só web, shared ou ingestão | `affected` → `ci / scope` → `test`/`typecheck` (~60 s) → `ci-gate`: ~2,5 min | 4–7 min   |
| Só documentação            | `affected` → `ci / lint` reduzido (~40 s) → `ci-gate`: ~1,5–2 min            | ~3 min    |

O `sonar` (~90 s depois do `ci`) e o CodeQL (35–85 s por linguagem) correm em paralelo e não
seguram o `ci-gate`. O novo caminho crítico, em PR de API, é o `sql-perf`.

### Consequências

- Bom, porque o merge espera menos da metade do tempo num PR típico e não depende de Codecov,
  SonarQube Cloud nem de advisory do dia.
- Bom, porque saem uma devDependency com exceção de proveniência (Steiger → chokidar), dois pacotes
  do commitlint, o pip-audit e o Codecov (App e badge).
- Ruim, porque uma queda do score de mutação só aparece na manhã seguinte, no run noturno, e não
  no PR que a causou. Mitigação: o score muda pouco entre commits, o relatório incremental aponta
  os mutantes novos, e `pnpm test:mutation` roda local.
- Ruim, porque um advisory novo só aparece no run diário ou no próximo push, não no PR. Mitigação:
  o Dependabot abre PR de segurança, e o `audit.yml` roda antes de todo deploy.
- Ruim, porque o quality gate do Sonar deixa de bloquear; cabe ao mantenedor olhar a decoração do
  PR. Os gates que bloqueiam (Biome, knip, jscpd, type-coverage, thresholds do Vitest, Semgrep,
  CodeQL) cobrem a maior parte do "Sonar way".
- Neutro: um commit local fora de Conventional Commits não é mais recusado; o título do PR, que vira
  a mensagem do squash, é.

### Confirmação

- `bash .github/scripts/ci-config.test.sh`: `ci-gate` com `!cancelled()` e os `needs` certos; só
  o `perf` pode pular; `mutation.yml` só agendado e pulando sem commit novo; nenhum `pnpm audit` de
  advisories no `ci.yml`; `audit.yml` sem `pull_request` e com o osv-scanner, que não está mais no
  `security.yml`; `dependency-review` no PR; `sonar.yml` com `continue-on-error`, sem
  `qualitygate.wait` e fora dos `needs` do `ci-gate`; nada de Codecov; camada do lint para PR de
  docs.
- `bash .github/scripts/affected.test.sh`: grupo `docs`, chave `code` e os workflows que não marcam
  tudo.
- actionlint e zizmor sem achados.

## Opções consideradas

- **Stryker incremental no PR, mas sem bloquear** (`continue-on-error`): continuaria no caminho
  crítico do `ci-gate`, que espera o workflow inteiro.
- **`pnpm audit` no PR com `continue-on-error`**: o resultado ficaria verde-com-aviso em todo PR e
  ninguém olharia; o run diário vermelho chega por e-mail.
- **Manter o Codecov só como comentário**: duplicaria o Sonar e manteria uma integração a mais.
- **Sonar dentro do `ci.yml` com `continue-on-error`**: deixaria de bloquear, mas o `ci-gate`
  continuaria esperando o scanner (o `ci` só termina quando todos os jobs dele terminam).

## Ações manuais do mantenedor

- ~~Tirar `Analyze (actions)` dos checks exigidos e da matriz do `codeql.yml`~~: feito em
  2026-11-13 (ruleset `checks-main`, 27001465).
- Desinstalar o App do Codecov do repositório (não há segredo: o upload era por OIDC).
- Nenhum segredo novo: o `STRYKER_DASHBOARD_API_KEY` continua no nightly, o `SONAR_TOKEN` (inclusive
  nos segredos do Dependabot) continua no `sonar.yml`.

## Mais informações

- Mudança OpenSpec `slim-ci-gates` (arquivada), capability `quality-gates`.
- [ADR 0002](0002-supply-chain-pnpm.md), adendo de 2026-11-12.
- Context7: `/actions/download-artifact` (padrão sem artifacts termina com 0 baixados; layout com um
  ou vários), `/zizmorcore/zizmor` (`unpinned-uses` com hash em toda action desde a 1.20;
  `artipacked`), `/websites/github_en_actions` (`continue-on-error` de job, contexto `needs`),
  `/evilmartians/lefthook/v2.2.2` (`env` por comando), `/actions/checkout/v7.0.1` (checkout
  esparso de um arquivo).
