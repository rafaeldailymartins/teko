# Tasks

## 1. Proteção e rate limit

- [x] 1.1 Guarda de `Origin`, `content-type` e query string nas mutações de `/api/v1/*`, com testes
- [x] 1.2 `PgRateLimitStore` e `RATE_LIMIT_PER_MINUTE`, ligados pelo `createHttpOptions`
- [x] 1.3 Teste de integração: o limite vale entre duas instâncias no mesmo Postgres

## 2. Rotas

- [x] 2.1 `CoverageSource` compartilhado, `GetCoverage` e `GET /api/v1/coverage`
- [x] 2.2 Contratos `provisions`, `word-diff`, casos de uso e `pg-provision-repository`
- [x] 2.3 Rotas `/api/v1/provisions*` com rate limit
- [x] 2.4 Plugin de eval (`GET /api/v1/_eval/search`) só com `APP_ENV=ci`; 404 em staging e produção

## 3. Documentação

- [x] 3.1 `backend.md` (superfície HTTP e variáveis)
