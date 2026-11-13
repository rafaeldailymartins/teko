# Tekó: instruções para agentes

Assistente RAG open-source (MIT) sobre legislação fiscal brasileira, com consciência de vigência.
"Tekó" em texto visível, `teko` em identificadores. Escreva em português do Brasil (commits, PRs,
docs, mensagens), no estilo do que já existe: frases diretas, sem jargão desnecessário.

## Fonte de verdade

- [`docs/roadmap.md`](docs/roadmap.md) (fases e DoD), [`docs/architecture/`](docs/architecture/)
  (desenho vigente), [`docs/adr/`](docs/adr/) e `openspec/specs/`. O plano de 2026-11-10 está
  congelado; não o use como referência.
- Status das fases e pendências: [`docs/status.md`](docs/status.md). Atualize-o no PR que fecha uma
  fase, spike ou pendência.
- Decisão que contrarie o roteiro ou a arquitetura precisa do aval do mantenedor; depois, corrija o
  documento e a ADR no mesmo PR. Desvios já aprovados não se revertem.
- ADR nova: próximo número livre (regras em [`docs/adr/README.md`](docs/adr/README.md)).
- Versões: vale o `catalog` do `pnpm-workspace.yaml`.
- Custo zero absoluto: nenhum serviço pago nem domínio próprio. Web e API no mesmo projeto Vercel
  Hobby (`tekoia` e `tekoia-staging`, `gru1`), banco no Neon Free, artefatos de ingestão no GitHub
  Releases, Plano B no Render Free (`infra/planb-render`).

## Como trabalhar

- **OpenSpec só quando muda requisito** (comportamento em `openspec/specs/**`): proponha a mudança,
  implemente, marque as tasks e arquive no mesmo PR (`pnpm exec openspec archive <nome> --yes`).
  `pnpm spec:validate` sempre verde.
- **Context7** para toda biblioteca, CLI ou serviço antes de implementar, inclusive os conhecidos.
  Registre os IDs no `design.md` da mudança (ou na ADR, se não houver mudança).
- Não crie issues nem adie trabalho para "outra issue": o que está bloqueado se diz em uma frase.

## Git e PRs

- Trunk-based (ADR 0033): o tronco é `main`. Push em `main` vai para o staging, e a produção sai
  por tag `v*`.
- Nunca faça push em `main`. Branch a partir de `origin/main` atualizado, com um
  prefixo permitido: `feature/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/`, `test/`, `ci/` ou
  `build/`.
- Commits com `git commit -s` (DCO; a assinatura SSH já está configurada). Conventional Commits,
  com escopo da lista única (`.github/commit-types.json`). `Signed-off-by` e depois `Co-Authored-By`.
- **Para atualizar a branch de um PR, use `gh pr update-branch`; nunca faça merge local sem
  `--signoff`:** o `dco` só isenta o merge commit do `web-flow`.
- O PR usa o template; o título vira a mensagem do squash. Com os checks verdes,
  `gh pr merge <n> --auto --squash`. Nunca force-push em branch de PR alheia.

## Gates antes do push

- `pnpm verify`: camada rápida (lint, typecheck, knip, `lint:deps`, `lint:monorepo`, dup,
  type-coverage, `spec:validate`, `check-lockfile`, `test:unit`). O pre-push roda a versão afetada.
- `pnpm verify:full` antes de PR que toca integração, ingestão, build ou CI: soma integração
  (Testcontainers, Docker ligado), `test:scripts`, build, os testes de shell do CI
  (`verify:ci`), o Python (`verify:python`) e o audit (`verify:audit`). Os dois chamam `pnpm` de
  novo, então ele precisa estar no PATH (`corepack enable` ou um atalho).
- Mutação só roda à noite no CI; ao mexer no domínio, rode `pnpm test:mutation` localmente.
- Workflows novos ou alterados: actionlint (Docker `rhysd/actionlint`) e
  `bash .github/scripts/ci-config.test.sh` (precisa de `jq` e `yq`).
- Em `tools/ingest`: `uv run --frozen ruff check . && uv run --frozen ruff format --check . && uv run --frozen pyright && uv run --frozen pytest`.

## Dependências e segredos

- Dependência nova entra pelo catálogo, com release de mais de 7 dias, licença da allowlist do
  `dependency-review` e proveniência. Nada de `npx` de pacote fora de um lockfile. CLIs de deploy
  ficam isolados em `tools/`, com lockfile e auditoria próprios (ADR 0002).
- Segredos nunca passam pelo chat nem pelo código. Ficam nos environments do GitHub ou nas env vars
  Sensitive da Vercel; quem cadastra é o mantenedor (`gh secret set NOME --env <env>`).
- Não mude rulesets, environments, segredos nem configurações de GitHub, Vercel ou Neon sem pedido
  explícito. Não faça deploy local: as CLIs usam o login salvo e publicam de verdade.

## Ambiente Windows do mantenedor

- O `pnpm` pode não estar no PATH: use
  `node "C:/Program Files/nodejs/node_modules/corepack/dist/pnpm.js"` (ou `corepack pnpm`).
- No Git Bash, `MSYS_NO_PATHCONV=1` para `vercel api` e Docker, com caminhos no formato Windows.
- O `vercel curl` repassa ao curl todo argumento que não é dele, inclusive o `--token` global. Em
  CI, o token vai pelo env `VERCEL_TOKEN`, e o smoke sempre passa `--protection-bypass`.
- **Saída longa** (testes, build, lint, logs) vai para um arquivo no diretório temporário da
  sessão, fora do repositório, com o código de saída impresso, e depois se filtra o arquivo:
  `cmd > "$TMP/saida.txt" 2>&1; echo "exit=$?"` e `grep -a` em seguida. Nunca pipe para `head`,
  `tail` ou `tee`: o pipe esconde o código de saída.
