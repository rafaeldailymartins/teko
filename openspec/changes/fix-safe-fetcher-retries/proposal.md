# Proposal

## Why

Um `ECONNRESET` ao baixar o RCTE do site da Sefaz-GO derrubou o `discover` do ingest de
2026-11-12 (run 43285630023): os outros 34 downloads tinham dado certo, mas um erro de rede
passageiro bastava para parar o run inteiro. O `source-watch` diário usa o mesmo `SafeFetcher` e
está sujeito ao mesmo problema.

## What Changes

- `SafeFetcher`: até 2 novas tentativas, com espera de 2 s e depois 4 s, para erro de rede
  transitório (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EPIPE`, `EAI_AGAIN`, `ENETUNREACH`,
  `EHOSTUNREACH`, "socket hang up") e para 502, 503 e 504. Cada tentativa refaz a checagem de DNS
  e respeita o intervalo de 1 s por host; tudo fica dentro do mesmo timeout total.
- Bloqueio de segurança (`BlockedRequestError`), cancelamento e qualquer outro erro nunca são
  repetidos.

## Capabilities

### Modified Capabilities

- `corpus-ingestion`: o download seguro tenta de novo falhas de rede transitórias.

## Impact

- `apps/api/src/adapters/out/http/safe-fetcher.ts` e testes. Sem dependência nova, sem mudança de
  workflow.
