# Tasks

## 1. SafeFetcher

- [x] 1.1 Novas tentativas para erro de rede transitório e 502/503/504 (2 s e 4 s), dentro do timeout total; segurança e cancelamento nunca repetem
- [x] 1.2 Testes: recupera de `ECONNRESET` e 503, esgota as tentativas, não repete 404, erro desconhecido, bloqueio nem cancelamento; `isTransientNetworkError`

## 2. Verificação

- [x] 2.1 Próximo `ingest.yml` e `source-watch` sem queda por erro de rede passageiro: os ingests de 2026-11-12 (runs 43310478405, 43311921484, 43322283697 e 43332437880) baixaram tudo; as falhas de dois deles foram no `load` (URL http do plano, #56) e no gate do `corpus-eval` (#59), não na rede. O `source-watch` 43462349735 (2026-11-13) verificou as 9 páginas do `corpus/watch.yaml` sem erro
