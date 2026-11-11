# Tekó: instruções para agentes

Assistente RAG open-source (MIT) sobre legislação fiscal brasileira, com consciência de vigência.
"Tekó" em texto visível, `teko` em identificadores. Escreva em português do Brasil (commits, PRs,
docs, mensagens), seguindo o estilo do que já existe.

## O plano é a fonte de verdade

- Plano aprovado em 2026-11-10, com o roteiro por fases F0–F10:
  `C:\Users\rafae\.claude\plans\ent-o-vamos-l-eu-sharded-dawn.md`. Antes de começar uma fase, leia
  a seção dela em "Roteiro por fases" e as seções técnicas que ela cita (Backend, Ingestão,
  Frontend, Qualidade, CI/CD, Observabilidade). Desvios do pedido original estão em "Decisões e
  desvios"; não os reverta.
- Uma decisão que contrarie o plano precisa do aval do mantenedor. Depois, atualize o plano e o
  ADR correspondente em `docs/adr/`.
- Versões: vale o `catalog` do `pnpm-workspace.yaml`, não as versões citadas no plano.
- Custo zero absoluto: não introduzir serviço pago, Netlify Functions, Netlify DB nem domínio
  próprio. API na Vercel Hobby (`teko-api`, `teko-api-staging`, região `gru1`), web estático na
  Netlify, banco no Neon Free, Plano B no Render Free (`infra/planb-render`).

## Status das fases

Atualize esta seção no PR que fecha cada fase ou spike.

- **F0 (contas e governança):** concluída. Falta só conferir o primeiro PR do Dependabot
  (`chore(deps): …`).
- **F1 (esqueleto, gates e spikes):** esqueleto, gates e CI em `develop`. Spikes pendentes:
  - (b) API na Vercel: o builder zero-config mantém imports `.ts` no `server.js` e a Function cai
    com `ERR_MODULE_NOT_FOUND`. Vale o fallback do plano: o tsdown gera o Build Output API
    (`.vercel/output`) e o CI pula o `vercel build`.
  - (a) web na Netlify: falta o Netlify CLI isolado em `tools/netlify-cli`, como o
    `tools/vercel-cli`.
  - (c) proxy Netlify → Vercel e (d) pooler do Neon dependem de (a) e (b).
  - (e), (f) e (g) rodam localmente. O (f) provavelmente precisa do token do Cloudflare Workers AI
    (embeddings BGE-M3).
- **F2 em diante:** não começar antes de fechar as pendências da F1 (decisão do mantenedor).

## Como trabalhar

**Especificação e documentação**

- Cada fase lista mudanças OpenSpec. Proponha a mudança (`/opsx:propose`) antes de escrever
  código, implemente por ela e mantenha `openspec validate --all --strict --no-interactive`
  passando.
- Consulte o Context7 para toda biblioteca, CLI ou serviço antes de implementar, inclusive os
  conhecidos. Registre os IDs no `design.md` da mudança.

**Git Flow e PRs** (os rulesets do GitHub impõem tudo isto)

- Nunca faça push em `develop` ou `main`. Crie a branch a partir de `develop` com um prefixo
  permitido: `feature/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/`, `test/`, `ci/` ou
  `build/` (`release/vX.Y.Z` e `hotfix/vX.Y.Z` só para release).
- Commits assinados e com DCO: `git commit -s` (a assinatura SSH já está configurada). Mensagem
  em Conventional Commits, com escopo da lista do `.github/pull_request_template.md`.
- O PR usa o template. O título vira a mensagem do squash. Para `develop`, use squash; para
  `main`, merge commit. Não há aprovação obrigatória (mantenedor único): com os 7 checks verdes,
  `gh pr merge <n> --auto --squash` faz o merge.

**Gates locais antes do push** (o pre-push do lefthook roda só typecheck e testes afetados)

`pnpm lint`, `pnpm typecheck`, `pnpm knip`, `pnpm lint:deps`, `pnpm lint:fsd`,
`pnpm exec turbo boundaries`, `pnpm lint:monorepo`, `pnpm dup`, `pnpm type-coverage`,
`pnpm spec:validate`, `pnpm check-lockfile`, `pnpm test:unit`, `pnpm test:integration`,
`pnpm test:scripts`, `pnpm build`, `pnpm audit --audit-level low` (e o mesmo em
`tools/vercel-cli`), `bash .github/scripts/affected.test.sh`, `bash .github/scripts/ci-config.test.sh`
e, em `tools/ingest`, `uv run --frozen ruff check . && uv run --frozen pyright && uv run --frozen pytest`.
Workflows novos ou alterados passam pelo actionlint (Docker `rhysd/actionlint`). Mutação: o
Stryker de cada pacote alterado, com limite de 70.

**Dependências e segredos**

- Dependência nova entra pelo catálogo, com release de mais de 7 dias, licença da allowlist do
  `dependency-review` e proveniência. Nada de `npx` de pacote fora de um lockfile. CLIs de deploy
  ficam isolados em `tools/`, com lockfile e auditoria próprios (ADR 0002).
- Segredos nunca passam pelo chat nem pelo código. Ficam nos environments do GitHub (`staging`,
  `production` etc.). Quem cadastra é o mantenedor, com `gh secret set NOME --env <env>`.
- O SonarQube Cloud (plano gratuito) analisa só PRs e a branch principal, que lá é `develop`.

**Ambiente Windows do mantenedor**

- O `pnpm` pode não estar no PATH. Use um atalho para
  `node "C:/Program Files/nodejs/node_modules/corepack/dist/pnpm.js"`.
- No Git Bash, `MSYS_NO_PATHCONV=1` para `vercel api` e Docker, com caminhos no formato Windows.
- O `vercel curl` repassa ao curl todo argumento que não é dele, inclusive o `--token` global. Em
  CI, o token vai pelo env `VERCEL_TOKEN`, e o smoke sempre passa `--protection-bypass`.
- Saída longa (testes, build, logs) vai para um arquivo no scratchpad da sessão, com o código de
  saída impresso. Nunca use pipe para `head`/`tail`/`tee`, porque ele esconde o código de saída.
