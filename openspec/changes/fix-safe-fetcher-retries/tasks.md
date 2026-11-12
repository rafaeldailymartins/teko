# Tasks

## 1. SafeFetcher

- [x] 1.1 Novas tentativas para erro de rede transitório e 502/503/504 (2 s e 4 s), dentro do timeout total; segurança e cancelamento nunca repetem
- [x] 1.2 Testes: recupera de `ECONNRESET` e 503, esgota as tentativas, não repete 404, erro desconhecido, bloqueio nem cancelamento; `isTransientNetworkError`

## 2. Verificação

- [ ] 2.1 Próximo `ingest.yml` e `source-watch` sem queda por erro de rede passageiro
