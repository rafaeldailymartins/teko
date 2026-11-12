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

- **F0 (contas e governança):** concluída, menos um item do DoD. Repositório, rulesets, segurança,
  App de release, environments, Scorecard (7,4) e `/healthz` dos dois projetos Vercel conferidos
  em 2026-11-11. O spike de environments em `pull_request` mostrou que a regra é avaliada contra
  `refs/pull/N/merge` (ADR 0024): o `release-rehearsal` passa a aceitar todas as branches no PR
  que criar o `release-gate.yml`, com filtro por `github.head_ref`. O environment `maintenance`
  (só `develop`) foi criado em 2026-11-11. O `dependabot.yml` estava inválido (o GitHub recusa
  `semver-*-days` no `cooldown` de `github-actions`) e nenhuma rodada tinha rodado; corrigido, com
  uma checagem no `ci-config.test.sh`. Falta o primeiro PR do Dependabot (`chore(deps): …`):
  quando vier, marcar a tarefa 3.7 e arquivar `bootstrap-repository-governance`.
- **F1 (esqueleto, gates e spikes):** concluída em 2026-11-11, com a ADR 0003 `accepted` e as
  mudanças `scaffold-monorepo` e `setup-quality-gates-ci` arquivadas. CI de PR em cerca de 4 min;
  um segredo de teste reprova o `ci-gate`. O badge do Stryker passou a ter valor com o `mutation.yml`
  da F2. OpenSSF Best Practices no nível `passing` desde 2026-11-11 (projeto 16550; análise
  dinâmica marcada `Unmet` até o ZAP da F8, e release notes `N/A` até a v0.1.0). Spikes:
  - (a) web na Netlify: concluído. Site `tekoia` (time `rafael-daily-santos-martins`, a conta do
    token do CI), `tools/netlify-cli` isolado, `@netlify/plugin-nextjs` fixado no lockfile,
    proteção de visitantes desligada. A Netlify troca `/pt-BR/` por `/pt-br/`: tratar na F5.
  - (b) API na Vercel: concluído. Build Output API montado do bundle do tsdown (ADR 0017),
    Function `index` em `gru1` com Node 24, SSE de 95 s sem corte, promote durante stream e
    `waitUntil` ok; a desconexão só é percebida com `supportsCancellation`, que passou a ser
    padrão com `maxDuration` de 120 s. SIGTERM e cold start ficam como risco residual.
  - (c) proxy Netlify → Vercel: concluído. `x-nf-sign` verificado, `deploy_context=branch-deploy`
    no alias `develop`, `NETLIFY_CLIENT_IP_TRUSTED = true` (só com assinatura). No Netlify Free o
    `NETLIFY_PROXY_JWS_SECRET` é variável comum, com travas contra vazamento no bundle.
  - (d) pooler do Neon: concluído. Timeouts no role valem pelo pooler, que recusa
    `statement_timeout` como parâmetro de conexão; o resume cabe no corte de 26 s. O `pg` nunca
    teve proveniência: decidir o driver na F2, junto com o `attachDatabasePool`.
  - (e) concluído; (g) concluído no escopo da F1 (inclusive as ferramentas de lint e CI): as
    bibliotecas ainda não introduzidas são conferidas pelas fases que as introduzem.
  - (f) ingestão: concluído. Docling com TableFormer V1 `ACCURATE` (o V2 desmonta as tabelas de
    campos; Guia 3.2.4 inteiro em 71,7 min, 457 tabelas); WS de Tabelas Externas em TXT cp1252 com
    SHA-1 nos metadados; `bge-m3` com `[n, 1024]` e custo real em `meta.neurons`; red team sem
    `hijacking` e com `jailbreak:tree` e `jailbreak-templates` (os planejados são remote-only). O
    token do Workers AI está no `tools/ingest/.env` local e no environment `staging`
    (`CF_AI_TOKEN`, `CF_ACCOUNT_ID`).
  - As rotas `/api/_spike/*` e a `TEKO_SPIKE_SENSITIVE` saíram do código; os workflows de spike
    ficam só com os passos que não dependem delas, como referência para a F7. As env vars Config
    da F1 do `teko-api-staging` foram gravadas à mão (a F7 automatiza).
  - O projeto `teko-api` (produção) existe e `teko-api.vercel.app` está reservado por um
    placeholder (a API real e as env vars chegam na F7).
  - Riscos residuais, registrados na ADR 0003: SIGTERM e cold start não medidos com rigor;
    `attachDatabasePool` e driver do Postgres na F2 (o `pg` nunca teve proveniência); WAF na F7;
    `/pt-br/` minúsculo na F5.
- **F2 (domínio de vigência, schema e busca híbrida):** concluída em 2026-11-11 (mudanças arquivadas
  `add-validity-domain`, `add-corpus-schema`, `add-hybrid-search`; ADRs 0009 e 0010). Driver `pg`
  8.23.1, exceção de proveniência no ADR 0002 (nenhum driver Postgres do npm tem), junto com
  Testcontainers, `yaml` e os overrides de `glob`/`basic-ftp` da árvore do promptfoo. Fixture
  única com textos reais (1.574 chunks, vetores BGE-M3 reais em `embeddings.json.gz`; regenerar
  com `pnpm --filter @teko/api fixtures:embed` e as credenciais do `tools/ingest/.env`) e golden
  de 50 casos revisado pelo mantenedor em 2026-11-11. Retrieval evals: recall@10
  0,925, MRR 0,771, demais 1,00; `sql-perf` em ~120–135 ms. Roles do Neon criados em 2026-11-11
  com `scripts/neon-roles.ts` (`teko_watch` no staging; `teko_app` e `teko_watch` na produção),
  com as URLs `-pooler` em `maintenance` e `corpus-watch`; nenhuma migração rodou ainda nos
  projetos reais (a primeira é do `deploy-api.yml`, F7). Ver `docs/runbooks/neon-roles.md`.
- **F3 (ingestão C1 e C2, embeddings e watch):** concluída em 2026-11-12. Código entregue em
  2026-11-11 (#25); o primeiro run real no staging, em 2026-11-12, trouxe correções em PRs
  próprios (#26 a #46). Mudanças arquivadas `add-rcte-cte-html-parser`,
  `add-go-code-tables-ingestion`, `add-embedding-pipeline`, `add-docling-pdf-extraction`,
  `add-sped-guides-ingestion`, `add-parser-revision`, `add-reranker` e
  `fix-hybrid-search-provision-dedup`; ficam abertas `add-source-change-monitoring` (primeiro
  `source-watch` agendado) e `fix-safe-fetcher-retries` (#46). ADRs 0011 e 0026 e 0027
  (accepted) e 0025 (`proposed`, reconciliação por janela: precisa do aval do mantenedor).
  Peças:
  - `corpus/` (fontes com sha256 reais, períodos de leiaute, overrides, lock e `watch.yaml`);
  - parsers em `apps/api/src/adapters/in/cli/ingest/parsers/`;
  - `IngestDocumentVersion` incremental, com `embedding_cache` como checkpoint, orçamento de
    neurons (código 75) e guarda de 800 MB;
  - snapshot `.jsonl.zst` com promoção, `SafeFetcher` e Netlify Blobs;
  - subcomandos `ingest`, `snapshot`, `eval-fixture`, `sources-watch` e `coverage-mark`;
  - `ingest.yml` e `source-watch.yml`.

  Medido nos arquivos oficiais: 95,8% das `NotaVigncia` do RCTE e 96,6% das do CTE, o resto
  `pending`. Desvios no plano (seção F3): staging migrado pelo `ingest load --migrate`; Guias
  3.0.1–3.1.8 desabilitados (só http); REINF pelo pacote de XSD.

  Staging em 2026-11-12 (corpus_version 10, run 43287466540): as 36 fontes das ondas C1 e C2
  publicadas; Docling de 9 a 15 min por parte de 125 páginas (40 partes, 6 em paralelo); carga
  completa em cerca de 5 mil neurons. `corpus-eval` verde pela primeira vez: recall@10 0,925, MRR
  0,681 e demais 1,00, com o reranker do Workers AI (ADR 0027) e os limites próprios do corpus real
  (`retrieval-corpus`, MRR ≥ 0,65; a meta de 0,70 é da F4). Lições do primeiro run, já no código:
  - o `docling-models` baixa só `layout` e `tableformer` (o OCR vinha do ModelScope, bloqueado);
  - correção de parser só chega a arquivo já ingerido com a revisão do parser incrementada
    (`PARSER_REVISIONS`, ADR 0026);
  - `lock-pr` e `corpus-eval` rodam com o `extract` pulado (`!cancelled()` explícito), e o PR
    novo do lock fecha os anteriores;
  - o `ci-gate` aceita `mutation` e `perf` pulados (PR que só muda `corpus/`).

  Pendências:
  - primeiro `source-watch` agendado (`verified_at` diário; depois passar o harden-runner dele
    para `block`) e arquivar `add-source-change-monitoring`;
  - conferir o tamanho do staging (`corpus.ingestion_runs.db_bytes`, alvo ≤ 400 MB);
  - arquivar `fix-safe-fetcher-retries` depois de um run sem queda por erro de rede.
- **F4 em diante:** a F4 começa quando o mantenedor decidir.

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
`pnpm test:scripts`, `pnpm build`, `pnpm audit --prod --audit-level low` (e `pnpm audit --audit-level low`
em `tools/vercel-cli` e `tools/netlify-cli`), `bash .github/scripts/affected.test.sh`,
`bash .github/scripts/ci-config.test.sh`, `bash .github/scripts/migration-guard.test.sh` e, em
`tools/ingest`, `uv run --frozen ruff check . && uv run --frozen ruff format --check . && uv run --frozen pyright && uv run --frozen pytest`.
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
