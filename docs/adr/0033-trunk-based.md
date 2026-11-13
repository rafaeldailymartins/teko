---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0033 — Trunk-based com `main` como tronco, produção por tag `v*` e changelog pelo git-cliff

## Contexto e problema

O plano adotou Git Flow: `develop` (padrão, staging), `main` (produção), branches
`release/vX.Y.Z` e `hotfix/vX.Y.Z`, merge commit em `main` e back-merge automático de `main` para
`develop`. Para um mantenedor solo, isso custa caro e não protege nada que a tag e o environment
não protejam:

- dois pares de rulesets (`checks-*` e `review-*`) com a mesma lista de checks, mais o
  `gitflow-guard` para impedir PR errado em `main`;
- o `release-gate.yml` em `pull_request` esbarrou na regra de branch dos environments, que é
  avaliada contra `refs/pull/N/merge` ([ADR 0024](0024-environments-em-pull-request.md)), e
  obrigou a abrir o `release-rehearsal` para todas as branches;
- back-merge, merge commits, `release/*` aberto em paralelo e a pergunta "isso já está em `main`?"
  a cada hotfix;
- hoje `main` só tem o commit inicial: nenhuma release saiu, então a troca não tem histórico a
  migrar.

## Fatores de decisão

- Produção só recebe código construído e atestado no CI, com revisor no environment `production`.
- Um só caminho de integração, sem back-merge.
- Checks exigidos com nomes estáveis, para trocar os rulesets sem janela sem proteção.
- Nada de push direto no tronco; commits assinados e com DCO.

## Opções consideradas

- **Trunk-based: `main` como tronco, produção por tag `v*`.**
- Manter o Git Flow do plano.
- GitHub Flow com deploy de produção a cada merge.

## Decisão

Opção escolhida: **trunk-based**.

- `develop` é **renomeada** para `main` e continua sendo o branch padrão. A `main` antiga, que só
  tem o commit inicial (ancestral de `develop`), é apagada antes do rename.
- Todo trabalho entra em `main` por PR com **squash** (título em Conventional Commits). Merge
  commit e rebase ficam desligados.
- **Push em `main` = staging.** Os workflows que hoje reagem a push em `develop` (deploy de
  staging, Sonar, CodeQL, Scorecard, audit, cache do Turbo) passam a reagir a `main`.
- **Produção por tag `v*`.** O `release.yml` (`workflow_dispatch`) calcula a versão com o
  git-cliff, abre um PR `chore(release): vX.Y.Z` com o `CHANGELOG.md` e as versões dos
  `package.json`/`pyproject.toml`, e, depois do merge, a App `teko-release-bot` cria a tag
  `vX.Y.Z` no commit do merge (o ruleset `release-tags` continua: só a App cria, altera ou apaga
  `v*`). O push da tag dispara o `release.yml`, em que o **`release-gate` é um job**
  (`neon-rehearsal`, evals completas, e2e, `perf` pré-release, ZAP baseline, `spec:validate` e
  `staging-verified`, que exige smoke e system test verdes no staging para o mesmo SHA). Os jobs
  de produção (`migrate`, publicação do release imutável, `promote-corpus`, deploy, smoke) usam o
  environment `production`, que aceita só a tag `v*` e tem o mantenedor como revisor.
- **Hotfix** é um release patch a partir de `main`: a correção entra por PR comum e o
  `release.yml` roda com `bump: patch`. O disparo automático do `prod-vuln-scan` (só high e
  critical, ADR 0032) faz o mesmo.
- **Saem:** o check `gitflow-guard`, os rulesets separados de `main` e `develop`, as branches
  `release/*` e `hotfix/*` (e as exceções delas no `branch-names`), o back-merge, o job `finish`
  disparado por push em `main` e o git-flow-next local.
- **Ficam:** `ci-gate`, `pr-title`, `dco`, `Analyze (*)` (o `Analyze (actions)` sai quando o
  mantenedor tirá-lo do ruleset, ADR 0032), `required_signatures`, `non_fast_forward`,
  `deletion`, `code_scanning`, `required_review_thread_resolution`, `strict`.

### Transição

Enquanto o mantenedor não troca os rulesets e o branch, nada muda no repositório: `develop`
continua o padrão e os nomes dos checks exigidos (`ci-gate`, `pr-title`, `gitflow-guard`, `dco`,
`Analyze (*)`) continuam existindo. A troca segue a ordem abaixo, e um PR de seguimento ajusta o
código (lista ao fim).

### Ações manuais do mantenedor

Feitas por quem tem admin no repositório, sem PRs de outros pacotes no meio do caminho (o rename
redireciona os PRs abertos de `develop` para `main`, mas um merge durante os passos 1 a 4 entraria
com regras pela metade). Os IDs são os de 2026-11-12 (`gh api repos/$R/rulesets` e
`gh api repos/$R/environments/<env>/deployment-branch-policies` os listam de novo).

```bash
R=rafaeldailymartins/teko
TMPD="$(mktemp -d)"; echo "TMPD=$TMPD"

# 1. Rulesets da main antiga saem (bloqueiam a exclusão do branch)
gh api -X DELETE "repos/$R/rulesets/27001467"; echo "exit=$?"   # checks-main
gh api -X DELETE "repos/$R/rulesets/27001473"; echo "exit=$?"   # review-main

# 2. Os rulesets de develop passam a mirar o branch padrão (acompanham o rename), só squash,
#    e o gitflow-guard deixa de ser exigido
gh api "repos/$R/rulesets/27001465" > "$TMPD/checks.json"; echo "exit=$?"
jq '{name: "checks-main", target, enforcement, bypass_actors,
     conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}},
     rules: [.rules[]
       | if .type == "pull_request" then .parameters.allowed_merge_methods = ["squash"]
         elif .type == "required_status_checks"
           then .parameters.required_status_checks |= map(select(.context != "gitflow-guard"))
         else . end
       | if .parameters == null then del(.parameters) else . end]}' \
  "$TMPD/checks.json" > "$TMPD/checks-main.json"; echo "exit=$?"
gh api -X PUT "repos/$R/rulesets/27001465" --input "$TMPD/checks-main.json"; echo "exit=$?"

gh api "repos/$R/rulesets/27001470" > "$TMPD/review.json"; echo "exit=$?"
jq '{name: "review-main", target, enforcement, bypass_actors,
     conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}},
     rules: [.rules[] | .parameters.allowed_merge_methods = ["squash"]]}' \
  "$TMPD/review.json" > "$TMPD/review-main.json"; echo "exit=$?"
gh api -X PUT "repos/$R/rulesets/27001470" --input "$TMPD/review-main.json"; echo "exit=$?"

# 3. A main antiga (só o commit inicial) sai, e develop vira main
gh api -X DELETE "repos/$R/git/refs/heads/main"; echo "exit=$?"
gh api -X POST "repos/$R/branches/develop/rename" -f new_name=main; echo "exit=$?"
gh api "repos/$R" --jq .default_branch   # espera: main

# 4. Nomes de branch: saem develop, release/v* e hotfix/v*
gh api "repos/$R/rulesets/27001481" > "$TMPD/names.json"; echo "exit=$?"
jq '{name, target, enforcement, bypass_actors,
     conditions: (.conditions | .ref_name.exclude |= map(select(
       . != "refs/heads/develop" and . != "refs/heads/release/v*" and . != "refs/heads/hotfix/v*"))),
     rules: [.rules[] | if .parameters == null then del(.parameters) else . end]}' \
  "$TMPD/names.json" > "$TMPD/names-trunk.json"; echo "exit=$?"
gh api -X PUT "repos/$R/rulesets/27001481" --input "$TMPD/names-trunk.json"; echo "exit=$?"

# 5. Environments: os de develop passam a main; production e release-rehearsal só pela tag v*
gh api -X PUT "repos/$R/environments/staging/deployment-branch-policies/66246840" -f name=main; echo "exit=$?"
gh api -X PUT "repos/$R/environments/corpus-watch/deployment-branch-policies/66246861" -f name=main; echo "exit=$?"
gh api -X PUT "repos/$R/environments/maintenance/deployment-branch-policies/66344349" -f name=main; echo "exit=$?"
gh api -X PUT "repos/$R/environments/ops/deployment-branch-policies/66246867" -f name=main; echo "exit=$?"
gh api -X DELETE "repos/$R/environments/production/deployment-branch-policies/66246848"; echo "exit=$?"         # main (fica a tag v*)
gh api -X DELETE "repos/$R/environments/release-rehearsal/deployment-branch-policies/66246855"; echo "exit=$?"  # release/*
gh api -X DELETE "repos/$R/environments/release-rehearsal/deployment-branch-policies/66246856"; echo "exit=$?"  # hotfix/*
gh api -X POST "repos/$R/environments/release-rehearsal/deployment-branch-policies" -f name='v*' -f type=tag; echo "exit=$?"

# 6. Só squash no repositório
gh api -X PATCH "repos/$R" -F allow_merge_commit=false -F allow_squash_merge=true -F allow_rebase_merge=false; echo "exit=$?"
```

Depois, pela interface:

1. **SonarQube Cloud**: projeto `rafaeldailymartins_teko` → Administration → Branches and Pull
   Requests → no branch principal (`develop`), "Rename" para `main`. O plano gratuito analisa só o
   branch principal e os PRs.
2. **Stryker Dashboard**: o relatório passa a ser publicado em `main` pelo nightly; nada a fazer
   além de conferir o primeiro relatório.
3. **Clone local** (e worktrees):
   `git fetch origin --prune && git branch -m develop main && git branch -u origin/main main && git remote set-head origin -a`.
4. **Tarefas agendadas** que criam branch a partir de `origin/develop` (a do harden-runner do
   `source-watch`, em 2026-11-13) precisam rodar antes do rename ou ser ajustadas para `main`.

### PR de seguimento (código)

Depois dos passos acima, um PR (`ci/`) troca `develop` por `main` e remove o Git Flow do código:

- gatilhos `push: branches: [develop]` e `TURBO_SCM_BASE` em `ci.yml`, `codeql.yml`,
  `scorecard.yml`, `security.yml`, `mutation.yml`, `pr-gate.yml`, `ingest.yml` e
  `.github/actions/setup/action.yml`;
- o job `gitflow-guard` sai do `pr-hygiene.yml`;
- `target-branch: develop` → `main` em todas as entradas do `.github/dependabot.yml`;
- `vcs.defaultBranch` do `biome.json`, `.github/scripts/{affected.test.sh,migration-guard.sh}`,
  `ci-config.test.sh`, `CODEOWNERS`;
- badges dos READMEs (`?branch=develop`, Stryker `/develop`), `CONTRIBUTING.md`, `SECURITY.md` e
  `CLAUDE.md`.

O `release.yml` com o `release-gate` como job chega na F9 ([roteiro](../roadmap.md)).

### Consequências

- Boa: um só tronco, sem back-merge nem `gitflow-guard`; os rulesets caem de seis para quatro.
- Boa: o `release-rehearsal` deixa de depender de `pull_request` e volta a ter a regra do
  environment como fronteira (a tag `v*`), o que encerra a ressalva da ADR 0024.
- Boa: com squash obrigatório, o histórico de `main` fica linear; o ruleset de linear history
  passa a ser possível (opcional).
- Ruim: o que está em `main` vai para o próximo release; um hotfix não pode pular trabalho já
  integrado. Mudança incompleta precisa entrar desligada (flag por env) ou esperar.
- Ruim: a tag é a única fronteira de produção; ela depende do ruleset `release-tags` e do revisor
  do environment `production`.

### Confirmação

- `gh api repos/$R --jq .default_branch` devolve `main`; `gh api repos/$R/rulesets` lista
  `branch-names`, `checks-main`, `release-tags` e `review-main`.
- Um PR de teste para `main` exige `ci-gate`, `pr-title`, `dco` e `Analyze (*)`, e não pede
  `gitflow-guard`.
- Um job com `environment: production` disparado por push em `main` é recusado; por tag `v*`,
  espera o revisor.

## Prós e contras das opções

### Manter o Git Flow

- Bom, porque já está configurado.
- Ruim, pelos custos do contexto: duplicação de rulesets, back-merge, `gitflow-guard` e a
  contingência da ADR 0024.

### GitHub Flow com produção a cada merge

- Bom, porque é o fluxo mais curto.
- Ruim, porque cada merge iria para produção sem `release-gate` (evals completas, e2e, rehearsal)
  e consumiria as cotas do Hobby a cada PR.

## Mais informações

- Altera a [ADR 0024](0024-environments-em-pull-request.md) (nota de revisão nela).
- Cobre o tema 0014 da lista do plano ("Git Flow + git-cliff"), que nunca foi escrito: o Git Flow
  sai, e o git-cliff continua gerando o `CHANGELOG.md` e a versão (`--bumped-version`).
- Fontes Context7 consultadas em 2026-11-12: `/websites/github_en_rest` (renomear branch,
  inclusive o padrão; políticas de branch e de tag dos environments; rulesets).
