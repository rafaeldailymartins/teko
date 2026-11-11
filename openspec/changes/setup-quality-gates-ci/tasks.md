# Tasks

## 1. Gates locais

- [x] 1.1 Configurar `lefthook.yml` (Biome, gitleaks, OpenSpec e lockfile no pre-commit; commitlint no commit-msg; typecheck e unit afetados no pre-push), com os binários chamados por `./node_modules/.bin/*`
- [x] 1.2 Configurar `commitlint.config.mjs` com os escopos e a regra `signed-off-by`, e conferir que a lista é a mesma do `CONTRIBUTING.md`
- [ ] 1.3 Conferir os hooks num commit de teste: mensagem sem escopo válido ou sem `Signed-off-by:` é rejeitada
- [x] 1.4 Configurar `pnpm knip` em dois modos (padrão e `--production --include dependencies,unlisted,unresolved,binaries`) e documentar no `CONTRIBUTING.md`

## 2. Workflows de PR

- [x] 2.1 Escrever `pr-gate.yml` (job `affected` + `ci-gate` com `alls-green`)
- [ ] 2.2 Conferir `pr-gate.yml` com actionlint e zizmor (nenhum dos dois está instalado na máquina de desenvolvimento; roda no `security.yml`)
- [x] 2.3 Escrever `ci.yml` (lint, lockfile, sherif, knip, OpenSpec, typecheck, lint:deps, lint:fsd, unit, integração, build com guarda de 0 functions, audit, Python) com upload ao Codecov via OIDC (`use_oidc: true`, sem token)
- [ ] 2.4 Conferir o `ci.yml` num PR de teste
- [x] 2.5 Escrever `security.yml` (gitleaks, zizmor, osv-scanner, Semgrep, dependency-review)
- [ ] 2.6 Conferir num PR de teste que um segredo de teste reprova o `ci-gate`
- [x] 2.7 Escrever `codeql.yml`, `pr-hygiene.yml` (`pr-title`, `gitflow-guard`, `dco`) e `scorecard.yml`
- [ ] 2.8 Conferir os nomes dos checks (`Analyze (...)`, `pr-title`, `gitflow-guard`, `dco`) num PR de teste
- [x] 2.9 Escrever `.github/affected-paths.yml` e `.github/scripts/affected.sh`
- [ ] 2.10 Conferir o escopo afetado num PR que só altera `apps/web`
- [ ] 2.11 Ligar a análise do SonarQube Cloud baseada em CI (análise automática desligada; segredo `SONAR_TOKEN`, variáveis `SONAR_ORGANIZATION` e `SONAR_PROJECT_KEY`) e conferir o quality gate num PR de teste

## 3. Rulesets, serviços e verificação

- [ ] 3.1 Tornar `ci-gate`, `Analyze (...)`, `pr-title`, `gitflow-guard` e `dco` obrigatórios nos rulesets `checks-*` (o Sonar entra pelo `ci-gate`; o check da App do SonarQube NÃO é obrigatório) e conferir num PR de teste
- [ ] 3.6 Cadastrar `SONAR_TOKEN` também como segredo do Dependabot (o valor não pode ser copiado de um segredo existente; é ação do mantenedor)
- [ ] 3.2 Conferir o DoD da F1: CI verde em até 8 minutos num PR típico
- [ ] 3.3 Acrescentar ao `design.md` os IDs Context7 que faltam, consultados pelos streams de CI e da raiz (ações do GitHub, knip, sherif, dependency-cruiser, steiger, commitlint, lefthook)
- [x] 3.4 Acrescentar ao `README.md` e ao `README.pt-BR.md` a linha de badges `flat-square` (CI e CodeQL em `develop`, OpenSSF Scorecard, OpenSSF Best Practices 16550, Codecov, quality gate do SonarQube Cloud `rafaeldailymartins_teko`, Stryker, licença e Node a partir de `engines`) e conferir os formatos de URL nas fontes de cada serviço
- [ ] 3.5 Conferir que os badges saem de "unknown" depois das primeiras execuções (Scorecard, Codecov, Sonar e Stryker dependem de execução no GitHub)

## Workflow follow-up

- Arquivar a mudança (`openspec archive setup-quality-gates-ci --yes`) no PR que concluir o grupo 3.
