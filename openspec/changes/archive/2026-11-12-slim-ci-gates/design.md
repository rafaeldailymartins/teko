# Design

## Contexto

Tempos dos últimos cinco runs verdes do `pr-gate.yml` (2026-11-12): `affected` 35–43 s;
`mutation / stryker` 262–432 s; `perf / sql-perf` 169–196 s; `ci / integration` 72–141 s;
`ci / sonar` 88–122 s, começando depois de `test`, `integration` e `python`; `ci / lint` 50–59 s;
`ci / audit` 48–61 s; jobs do `security.yml` 11–31 s. CodeQL, em workflow próprio, 25–85 s por
linguagem. O `ci-gate` esperava o Stryker em todo PR com pacote JS e o Sonar em todo PR.

## Decisões

1. **Mutação noturna com pulo por SHA.** O job `changes` lista, com `gh run list --workflow
   mutation.yml --branch <ref> --status success --limit 1`, o `headSha` do último run verde e
   compara com `github.sha`. Igual → `run=false` e o `stryker` pula. `workflow_dispatch` roda
   sempre. A permissão é só `actions: read`. O cache incremental passa a ser salvo em todo run (não
   há mais run de PR para envenená-lo).
2. **`audit.yml` reutilizável.** `push`, `schedule` diário, `workflow_dispatch` e `workflow_call`,
   para os deploys da F7 o chamarem antes de publicar. O `pnpm audit signatures` fica no PR (job
   `lint`): confere o que o PR instala e não depende de advisory.
3. **Sonar num workflow chamado.** Um job com `uses:` não aceita `continue-on-error`; por isso o
   `continue-on-error` fica no job do `sonar.yml`. O `pr-gate.yml` o chama com `needs: ci` (roda só
   se o `ci` passou), e o `ci-gate` não o lista em `needs`. Em push, o `ci.yml` o chama só em
   `develop`. Os artifacts de cobertura vêm de um único `download-artifact` com `pattern:
   coverage-*`: sem nenhum artifact o passo termina com 0 baixados; com um só, o conteúdo vai direto
   para o `path`; com vários, cada um vai para `path/<nome>`. O script trata os três casos.
4. **Lista única de tipos e escopos** em `.github/commit-types.json`, lida no `pr-title` por um
   checkout esparso só desse arquivo (`sparse-checkout-cone-mode: false`, sem credenciais) e
   passada à action como lista multilinha (`types`, `scopes`, já usadas assim).
5. **Escopo com `docs` e `code`.** `docs` segue a semântica dos outros grupos (algum arquivo do
   grupo mudou). `code` é derivada: `git diff --name-only` com `:(glob)**` menos
   `:(exclude,glob)<padrão>` de cada padrão do grupo `docs`. Sem base ou com configuração global
   alterada, tudo (inclusive `code`) fica `true`. Markdown dentro de um pacote ainda marca o pacote
   pelo turbo, mas as tasks excluem `**/*.md` dos inputs e o `--affected` não seleciona nada.
6. **`verify` por scripts do `package.json`.** Encadeados com `&&`, chamando `pnpm <script>` (fonte
   única de cada comando) e um único `turbo run` para as tasks por pacote, que paraleliza. Requer
   `pnpm` no PATH (`corepack enable`), como o resto do CONTRIBUTING.

## Alternativas consideradas

- Sonar dentro do `ci.yml` com `continue-on-error`: deixaria de bloquear, mas o `ci-gate` ainda
  esperaria o scanner, porque o job `ci` do `pr-gate.yml` só termina com todos os jobs do `ci.yml`.
- Três `download-artifact` com `name:`: falham quando o job produtor foi pulado por escopo.
- Script `scripts/verify.ts`: daria tempo por passo, mas teria de reimplementar a busca segura de
  executáveis do `cli-guards.ts`; os scripts encadeados bastam.

## Fontes Context7

| Biblioteca                          | ID                              | Versão | Tópicos                                                                             |
| ----------------------------------- | ------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| actions/download-artifact           | `/actions/download-artifact`    | v8     | `pattern` sem correspondência (0 baixados, sucesso); diretório com um ou vários     |
| zizmor                              | `/zizmorcore/zizmor`            | 1.32   | `unpinned-uses` (hash em toda action desde a 1.20), `artipacked`, `self-repository` |
| GitHub Actions                      | `/websites/github_en_actions`   | —      | `continue-on-error` de job, contexto `needs`, `!cancelled()`                        |
| Lefthook                            | `/evilmartians/lefthook/v2.2.2` | 2.2.2  | `env` por comando, `parallel`, hooks removidos                                      |
| actions/checkout                    | `/actions/checkout/v7.0.1`      | 7.0.1  | checkout esparso de um arquivo (`sparse-checkout-cone-mode: false`)                 |
| amannn/action-semantic-pull-request | (sem ID no Context7)            | 6.1.2  | `types` e `scopes` multilinha (inputs já em uso, sem mudança de versão)             |
