# Design

## Contexto

Os passos de API da ADR 0033 rodaram em 2026-11-13: `develop` virou `main` (branch padrão), os
rulesets `checks-main` e `review-main` miram `~DEFAULT_BRANCH` só com squash, o `gitflow-guard`
saiu dos checks exigidos e os environments `staging`, `corpus-watch`, `maintenance` e `ops` passaram
a `main`. O código ainda reagia a `develop`, que deixou de existir.

## Decisões

1. **Troca literal de `develop` por `main`** nos gatilhos, refs (`refs/heads/main`, `--ref main`,
   `?ref=main`, `git/ref/heads/main`, `--base main`), no `TURBO_SCM_BASE` do pre-push e no
   `vcs.defaultBranch` do Biome. `development` (APP_ENV, NODE_ENV, `prefix-development` e
   `dependency-type: development` do Dependabot) não é o branch e não muda.
2. **Artifacts `corpus-lock` de antes do rename.** O `workflow_run.head_branch` de um artifact é o
   nome do branch na época do run e não acompanha o rename. O filtro do `lock-pr` aceita `main` e
   `develop` (`head_branch | IN("main", "develop")`); os de `develop` expiram em até 90 dias, e o
   `develop` pode sair do filtro depois disso.
3. **`gitflow-guard` removido** do `pr-hygiene.yml` no mesmo momento em que deixou de ser exigido
   (os passos do ruleset rodaram antes deste PR). O DCO continua como requisito próprio em
   `quality-gates`.
4. **`target-branch: main`** em todas as entradas do `dependabot.yml`, como pede a ADR 0033. As
   atualizações de segurança sempre vão para o branch padrão, que agora é o mesmo.

## Fontes Context7

| Biblioteca  | ID                         | Versão | Tópicos                                                                         |
| ----------- | -------------------------- | ------ | ------------------------------------------------------------------------------- |
| GitHub REST | `/websites/github_en_rest` | —      | artifacts do repositório: `expired` e `workflow_run.head_branch`                |
| GitHub Docs | `/github/docs`             | —      | `target-branch` do `dependabot.yml`; atualizações de segurança no branch padrão |
