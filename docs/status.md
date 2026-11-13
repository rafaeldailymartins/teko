# Status das fases

Atualize este arquivo no PR que fecha cada fase, spike ou pendência. O que cada fase entrega está
no [roteiro](roadmap.md); o desenho, em [`architecture/`](architecture/README.md).

## Resumo

| Fase                                    | Situação                                     |
| --------------------------------------- | -------------------------------------------- |
| F0 contas e governança                  | concluída, menos o primeiro PR do Dependabot |
| F1 esqueleto, gates e spikes            | concluída em 2026-11-11                      |
| F2 domínio de vigência, schema e busca  | concluída em 2026-11-11                      |
| F3 ingestão C1 e C2, embeddings e watch | fechada em 2026-11-13                        |
| Revisão antes da F4                     | em andamento (pacotes A a E, 2026-11-12)     |
| F4 em diante                            | a F4 começa quando o mantenedor decidir      |

## F0: contas e governança

Repositório, rulesets, segurança, App de release, environments, Scorecard (7,4) e `/healthz` dos
dois projetos Vercel conferidos em 2026-11-11. O spike de environments em `pull_request` mostrou
que a regra é avaliada contra `refs/pull/N/merge` (ADR 0024). O environment `maintenance` (só
`develop`, hoje `main`) foi criado em 2026-11-11. O `dependabot.yml` estava inválido (o GitHub
recusa `semver-*-days` no `cooldown` de `github-actions`); corrigido, com checagem no
`ci-config.test.sh`.

Pendência:

- primeiro PR do Dependabot (`chore(deps): …`): quando vier, marcar a tarefa 3.7 e arquivar
  `bootstrap-repository-governance`.

## F1: esqueleto, gates e spikes

Concluída em 2026-11-11, com a ADR 0003 `accepted` e as mudanças `scaffold-monorepo` e
`setup-quality-gates-ci` arquivadas. CI de PR em cerca de 4 min (5,8 min de mediana medidos em
2026-11-12, com o Stryker no caminho crítico); um segredo de teste reprova o `ci-gate`. OpenSSF
Best Practices `passing` desde 2026-11-11 (projeto 16550; análise dinâmica `Unmet` até o ZAP da F8,
release notes `N/A` até a v0.1.0).

Spikes (detalhes na ADR 0003):

- **(a) web na Netlify** e **(c) proxy Netlify → Vercel**: concluídos, e superados em 2026-11-12
  pela mesma origem na Vercel (ADR 0029).
- **(b) API na Vercel**: Build Output API montado do bundle do tsdown (ADR 0017), Function `index`
  em `gru1` com Node 24, SSE de 95 s sem corte, promote durante stream e `waitUntil` ok; a
  desconexão só é percebida com `supportsCancellation`, padrão com `maxDuration` de 120 s.
- **(d) pooler do Neon**: timeouts no role valem pelo pooler, que recusa `statement_timeout` como
  parâmetro de conexão; o resume cabe com folga.
- **(e)** e **(g)**: concluídos; bibliotecas ainda não introduzidas são conferidas pelas fases que
  as introduzem.
- **(f) ingestão**: Docling com TableFormer V1 `ACCURATE` (o V2 desmonta as tabelas de campos; Guia
  3.2.4 inteiro em 71,7 min, 457 tabelas); WS de Tabelas Externas em TXT cp1252 com SHA-1;
  `bge-m3` com `[n, 1024]` e custo real em `meta.neurons`; red team sem `hijacking`, com
  `jailbreak:tree` e `jailbreak-templates`. O token do Workers AI está no `tools/ingest/.env` local
  e no environment `staging` (`CF_AI_TOKEN`, `CF_ACCOUNT_ID`).

As rotas `/api/_spike/*` e a `TEKO_SPIKE_SENSITIVE` saíram do código; os workflows `spike-*.yml`
saem com a ADR 0032. As env vars Config da F1 do projeto de staging foram gravadas à mão (a F7
automatiza).

Riscos residuais (ADR 0003): SIGTERM e cold start não medidos com rigor; WAF na F7.

## F2: domínio de vigência, schema e busca híbrida

Concluída em 2026-11-11 (mudanças arquivadas `add-validity-domain`, `add-corpus-schema`,
`add-hybrid-search`; ADRs 0009 e 0010). Driver `pg` 8.23.1, exceção de proveniência no ADR 0002,
junto com Testcontainers, `yaml` e os overrides de `glob`/`basic-ftp` da árvore do promptfoo.

- Fixture única com textos reais: 1.574 chunks, vetores BGE-M3 reais em `embeddings.json.gz`
  (regenerar com `pnpm --filter @teko/api fixtures:embed` e as credenciais do
  `tools/ingest/.env`). Golden de 50 casos revisado pelo mantenedor em 2026-11-11.
- Retrieval evals: recall@10 0,925, MRR 0,771, demais 1,00; `sql-perf` em cerca de 120–135 ms.
- Roles do Neon criados em 2026-11-11 com `scripts/neon-roles.ts` (`teko_watch` no staging;
  `teko_app` e `teko_watch` na produção), com as URLs `-pooler` em `maintenance` e `corpus-watch`
  ([runbook](runbooks/neon-roles.md)). Nenhuma migração rodou ainda na produção (a primeira é do
  deploy da F7).

## F3: ingestão C1 e C2, embeddings e watch

Concluída em 2026-11-12. Código entregue em 2026-11-11 (#25); o primeiro run real no staging, em
2026-11-12, trouxe correções em PRs próprios (#26 a #46).

- Mudanças arquivadas: `add-rcte-cte-html-parser`, `add-go-code-tables-ingestion`,
  `add-embedding-pipeline`, `add-docling-pdf-extraction`, `add-sped-guides-ingestion`,
  `add-parser-revision`, `add-reranker`, `fix-hybrid-search-provision-dedup` e
  `add-http-pinned-guides`; em 2026-11-13, `add-source-change-monitoring`,
  `fix-safe-fetcher-retries` (#46) e `fix-rcte-sem-efeitos-e-titulos-acrescidos` (revisão 2 do
  `go-html-state-machine`: notas "sem efeitos" da LC 194/2022 e títulos acrescidos como o
  "CAPÍTULO IV-A" da EFD; o próximo run reprocessa o RCTE e o CTE).
- ADRs 0011, 0025 (reconciliação por janela, aceita pelo mantenedor em 2026-11-12), 0026, 0027 e
  0028 (exceção http com pin), todas accepted.
- Medido nos arquivos oficiais: 95,8% das `NotaVigncia` do RCTE e 96,6% das do CTE, o resto
  `pending`.
- Desvios: staging migrado pelo `ingest load --migrate`; Guias de 2021 a 2024 do portal antigo em
  http com pin (ADR 0028); REINF pelo pacote de XSD.

**Staging em 2026-11-12** (corpus_version 10, run 43287466540): as 36 fontes das ondas C1 e C2
publicadas; Docling de 9 a 15 min por parte de 125 páginas (40 partes, 6 em paralelo); carga
completa em cerca de 5 mil neurons. `corpus-eval` verde pela primeira vez: recall@10 0,925, MRR
0,681 e demais 1,00, com o reranker do Workers AI (ADR 0027) e os limites próprios do corpus real
(`retrieval-corpus`, MRR ≥ 0,65; a meta de 0,70 é da F4).

**Guias de 2021 a 2024** (corpus_version 11): Guias 3.0.6, 3.0.8, 3.1.2, 3.1.3 e 3.1.6 do portal
antigo, em http com pin, e cobertura da EFD ICMS/IPI desde 2021-01-01. O staging foi de 265 MB
para 304 MB (673 neurons). `corpus-eval` verde (run 43332437880): recall@10 0,925, MRR 0,662 e
demais 1,00.

Lições do primeiro run, já no código:

- o `docling-models` baixa só `layout` e `tableformer` (o OCR vinha do ModelScope, bloqueado);
- correção de parser só chega a arquivo já ingerido com a revisão do parser incrementada
  (`PARSER_REVISIONS`, ADR 0026);
- `lock-pr` e `corpus-eval` rodam com o `extract` pulado (`!cancelled()` explícito), e o PR novo do
  lock fecha os anteriores;
- o `ci-gate` aceita `mutation` e `perf` pulados (PR que só muda `corpus/`).

**Source-watch** (2026-11-13): o cron `0 9 * * *` não disparou nesse dia (o GitHub descartou o
run agendado), e o run manual 43462349735 no `develop` foi verde: 0 mudança e 0 erro nas 9
páginas; `verified_at=2026-11-13` no staging pelo `teko_watch`, e a produção com o aviso esperado
de banco sem o schema `corpus` até a primeira promoção. O harden-runner dos três jobs passou para
`block`, com os hosts observados nesse run. O evento ao Sentry quando houver mudança fica para a
F6, que traz o DSN (TODO no workflow).

Sem pendências: a F3 está fechada.

## Revisão antes da F4 (2026-11-12)

O mantenedor aprovou as recomendações da revisão de arquitetura; os pacotes estão no
[roteiro](roadmap.md#revisão-antes-da-f4-2026-11-12). O plano de 2026-11-10 foi congelado: a fonte
de verdade passou a ser este diretório (ADR 0001, adendo de 2026-11-12).

Pendências:

- PRs dos pacotes A, B, B2, C, D e E entraram. Os artefatos da ingestão foram migrados do Netlify
  Blobs para o GitHub Releases em 2026-11-13 (run 43355872236 do `blobs-migrate.yml`: 150 itens,
  59 raw, 55 Docling, 33 de snapshot e 3 do watch, sem falha; o dry-run seguinte deu 150 iguais) e
  a etapa C2 tirou o Netlify Blobs do código e dos workflows (ADR 0030);
- revogação dos tokens e contas que saíram: o `NETLIFY_AUTH_TOKEN` e o `NETLIFY_SITE_ID` do
  environment `staging`, o site `tekoia` e a conta da Netlify; Codecov, Checkly e UptimeRobot;
- trunk-based (ADR 0033): renomear o branch principal no SonarQube Cloud (UI);
- remover o check `Analyze (actions)` do ruleset (ADR 0032);
- revisão do mantenedor dos casos do golden `holdout` (curadoria assistida por LLM).
