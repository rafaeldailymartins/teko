# Tasks

## 1. Busca e cobertura

- [x] 1.1 Aviso de fronteira pelas unidades das evidências (`periodBoundaryScopes`, `FindPeriodVersions`, `versionsInPeriod`), com testes unitários e de integração (CTE, art. 47, PA 2005-12)
- [x] 1.2 `postWorkersAi`: corpo ilegível degrada embeddings e reranker
- [x] 1.3 `retryTransientRead` na busca e na cobertura; pool `max: 3` e 8 s
- [x] 1.4 Busca em três idas ao banco e vigência como texto (teste de integração em `Asia/Tokyo`)
- [x] 1.5 `CheckCoverage` com cache de 10 min

## 2. Escrita do corpus

- [x] 2.1 `SeedFixtureCorpus` sobre o `IngestDocumentVersion`, com `FixtureCorpusStore`
- [x] 2.2 Remover `WriteCorpus`, `CorpusWriter` e `pg-corpus-writer`, e o `writeCorpus` do container HTTP
- [x] 2.3 Retrieval evals da fixture iguais caso a caso

## 3. Outros

- [x] 3.1 `server.ts` com import dinâmico da app depois do env
- [x] 3.2 `@teko/shared`: remover `partitionFamiliesByCoverage` e `singleDayInterval`
