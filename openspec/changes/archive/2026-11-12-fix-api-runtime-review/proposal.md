# Proposal

## Why

A revisão de arquitetura de 2026-11-12 (pacote A, aprovada pelo mantenedor antes da F4) achou
falhas no runtime da API que mudam comportamento especificado:

- o aviso de fronteira do PA não enxergava dispositivo que começa no meio do mês (a busca roda no
  dia 1, e toda evidência já vale nesse dia);
- corpo ilegível do Workers AI (não JSON, conexão cortada) derrubava a pergunta em vez de degradar;
- leituras não tinham o retry único depois do scale-to-zero do Neon, e a cobertura era lida do
  banco a cada pergunta (o plano manda 10 min em memória);
- havia dois caminhos de escrita do corpus, e o seed da fixture não passava pelo da ingestão real.

## What Changes

- `RetrieveEvidence`: sem fronteira nas próprias evidências, consulta as vigências com fronteira
  dentro do mês nas unidades de topo (artigo, registro, evento, tabela) das evidências e das chaves
  citadas (`FindPeriodVersions`, `SearchRepository.versionsInPeriod`).
- Adapters do Workers AI: leitura do corpo dentro do tratamento de erro (`postWorkersAi`).
- `retryTransientRead` (57P01, ECONNRESET) na busca e na leitura da cobertura; pool com `max: 3` e
  `connectionTimeoutMillis: 8_000`; busca em três idas ao banco (`set_config` num só `SELECT`
  junto do `BEGIN`) e vigência devolvida como texto.
- `CheckCoverage` com cache em memória de 10 min.
- `SeedFixtureCorpus` sobre o `IngestDocumentVersion`; saem `WriteCorpus` e `pg-corpus-writer`.
- `server.ts` importa a app dinamicamente depois do env (preparo para OTel e Sentry na F6).

## Capabilities

### Modified Capabilities

- `validity-domain`: aviso de fronteira pelas unidades das evidências; cobertura em memória.
- `hybrid-search`: degradação com corpo ilegível; retry único de leitura após queda de conexão.
- `corpus-schema`: escrita do corpus (e do seed) atômica por versão de documento, pela ingestão.

## Impact

- `apps/api/src/{domain/vigencia,application,adapters/out/{embeddings,reranker,persistence},
  adapters/in/cli/seed-fixtures,composition-root.ts,server.ts,cli.ts,config/env.ts}` e testes;
  `packages/shared/src/vigencia` (código morto removido).
- Retrieval evals da fixture iguais caso a caso (recall@10 0,925, MRR 0,771).
