# Tasks

## 1. Exceção http com pin

- [x] 1.1 `SafeFetcher`: `httpHosts` (http só na porta 80 desses hosts) e transporte `node:http`/`node:https` pelo protocolo
- [x] 1.2 Manifesto: fonte habilitada em http só em `HTTP_PINNED_HOSTS` e no modo `pinned`; `httpHostsOf`
- [x] 1.3 `ingest` passa `httpHostsOf` ao `SafeFetcher`; `sources-watch` não
- [x] 1.4 Testes do `SafeFetcher` e do manifesto

## 2. Corpus e workflow

- [x] 2.1 Habilitar os Guias 3.0.6, 3.0.8, 3.1.2, 3.1.3 e 3.1.6 com `page_ranges`; notas do 3.1.8 e do README
- [x] 2.2 `ingest.yml`: `sped.rfb.gov.br:80` no `discover` e matriz com `http://sped.rfb.gov.br/`; checagens no `ci-config.test.sh`
- [x] 2.3 Golden: `recusa-efd-antes-da-cobertura` em 2020-03
- [x] 2.4 ADR 0028, plano e `CLAUDE.md`

## 3. Verificação

- [x] 3.1 Ingest no staging com os cinco Guias publicados (run 43322283697: 304 MB, 673 neurons) e o `corpus-eval` verde (run 43332437880, com o `staging_validity` do E110 no golden)
