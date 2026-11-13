# Proposal

## Why

O PR gate levava 5,8 min na mediana (p90 de 9 min), e o caminho crítico era o `mutation / stryker`
(262 a 432 s), seguido do `sonar` esperando o quality gate. Dois gates reprovavam PRs por motivos
externos à mudança: o `pnpm audit` (advisory novo publicado no meio do dia, até em PR de
documentação) e o upload ao Codecov com `fail_ci_if_error` (queda do serviço). O mantenedor aprovou
em 2026-11-12, antes da F4, um CI enxuto (ADR 0032): menos ferramentas, nenhum gate que dependa de
serviço de terceiros ou de advisory do dia, e um PR de documentação que roda só o mínimo.

## What Changes

- **Mutação fora do PR:** o `mutation.yml` fica só com `schedule` (noturno, e só se houver commit
  novo desde o último run verde) e `workflow_dispatch`; o `pr-gate.yml` não o chama mais.
- **`pnpm audit` fora do PR:** vai para o `audit.yml` (push para develop/main, diário,
  `workflow_dispatch` e `workflow_call` para os deploys da F7). No PR ficam o `dependency-review` e o
  `pnpm audit signatures`.
- **Sonar informativo:** `sonar.yml` chamado depois do `ci`, fora dos `needs` do `ci-gate`, sem
  `sonar.qualitygate.wait` e com `continue-on-error`. **Codecov removido** (`codecov.yml`, uploads,
  `id-token: write`, badge); o gate de cobertura é o threshold do Vitest.
- **Ferramentas que saem:** `turbo boundaries` (e as tags dos pacotes), Steiger/`lint:fsd` (e a
  exceção `chokidar@4.0.3`), o hook `commit-msg` do commitlint (tipos e escopos numa lista única,
  `.github/commit-types.json`, lida pelo `pr-title`), o `pip-audit` (o osv-scanner audita o
  `uv.lock`) e os quatro `spike-*.yml` da F1.
- **`ci-gate` com `!cancelled()`**, dependendo de `affected`, `ci`, `security` e `perf` (só o
  `perf` pode pular).
- **Escopo afetado:** só `ci.yml`, `pr-gate.yml` e `perf.yml` (entre os workflows) marcam tudo;
  `ingest.yml` e `source-watch.yml` marcam o grupo `ingest`; os demais não marcam nada. Grupo novo
  `docs` (`docs/**`, `openspec/**`, `**/*.md`, `.claude/**`) e chave derivada `code`: num PR só de
  docs, o `lint` roda só Biome, lockfile e OpenSpec.
- **`pnpm verify` e `pnpm verify:full`** como scripts da raiz; o pre-push do lefthook roda a parte
  por pacote do `verify` nos pacotes afetados desde `origin/develop`.
- CODEOWNERS corrigido, `ci-config.test.sh` sem o que o zizmor já cobre.

## Capabilities

### Modified Capabilities

- `quality-gates`: o agregador ignora runs cancelados e não inclui o Sonar; o título do PR é o
  único ponto de conferência de Conventional Commits; o `pnpm audit` sai do PR; a mutação passa a
  ser noturna; PR só de documentação roda o mínimo.

## Fora de escopo

- Trocar o nome de checks exigidos nos rulesets: `ci-gate`, `Analyze (actions)`,
  `Analyze (javascript-typescript)`, `Analyze (python)`, `pr-title`, `gitflow-guard` e `dco`
  continuam existindo. A remoção do CodeQL `actions` e as mudanças de ruleset ficam com o
  mantenedor (ADR 0032). Trunk-based (ADR 0033) e a remoção da Netlify (ADR 0029) são de outras
  mudanças.
- O harden-runner do `source-watch.yml` (vira `block` pela tarefa agendada de 2026-11-13).

Fase: transição F3 → F4 ("antes da F4"). ADRs afetadas: 0032 (nova), 0002 (adendo).

## Impact

- `.github/workflows/{ci,pr-gate,pr-hygiene,mutation,audit,sonar}.yml`, `.github/scripts/*`,
  `.github/affected-paths.yml`, `.github/commit-types.json`, `.github/CODEOWNERS`,
  `.github/zizmor.yml`, `turbo.json`, `package.json`, `pnpm-workspace.yaml`, `lefthook.yml`,
  `tools/ingest/{pyproject.toml,uv.lock}`, README, CONTRIBUTING e ADR 0002.
- Integrações que o mantenedor pode desligar: o App do Codecov.
