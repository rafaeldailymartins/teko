# Design

## Context7

- Workers AI: `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` (erros: `3036` "Account
  limited", HTTP 429, cota diária de 10.000 neurons; `3040` "Out of capacity", 429 transitório;
  limites zeram às 00:00 UTC).
- pgvector, Drizzle e Postgres: sem API nova (índice parcial com `.where()` do Drizzle, já usado no
  `review_queue_open_note`).

## Decisões

1. **Lacuna por entrada (A1, M1).** `coverage.gap_entries` (jsonb) guarda cada lacuna com os
   documentos que a resolvem (`covers` no `corpus/watch.yaml`), a vigência e o instante da
   detecção (`generatedAt` do `discovered.json`). `gaps` e `gap_reason` continuam sendo o que o
   `CheckCoverage` lê, regravados como a soma das entradas. A ingestão tira só a entrada cujo
   documento tem versão publicada criada depois da detecção (reprocessar uma versão antiga pela
   revisão do parser não resolve nada). A promoção adota as entradas do snapshot e mantém as do
   destino detectadas depois do `createdAt` do snapshot: instante, não data, porque a exportação e
   o watch podem cair no mesmo dia. O backfill da migração transforma `gaps` em entradas sem
   documento e sem detecção (resolvidas por qualquer publicação da família; na promoção, valem
   como anteriores ao snapshot).
2. **Disjuntor e gate de saúde.** O disjuntor compara a versão com as redações abertas que cruzam
   a janela (mínimo de 20): fechar mais de 20%, perder mais de 10% dos dispositivos ou dobrar a
   fração `pending` (com pelo menos 2 p.p. de alta). O gate compara o estado publicado por
   documento com o `health` do `corpus.lock.json`, gravado só em run verde: um run reprovado
   continua comparado com a mesma base no seguinte. Run reprovado não chama o `RefreshCoverage`;
   o run verde seguinte recalcula também as famílias com chunks ainda sem versão.
3. **Vetor só no conhecimento aberto.** A busca filtra `upper_inf(c.knowledge)` no mesmo `WHERE`
   do ANN e do léxico, então o HNSW e o GIN podem ser parciais com os mesmos nomes. A ingestão
   apaga o vetor depois dos recortes (que o copiam). Medido na fixture com metade dos chunks
   fechados: `corpus.chunks` 39,9% menor.
4. **Impressão digital.** Hash do `ParsedSource` sem o sha256 e sem as estatísticas; comparada
   com as versões publicadas do mesmo documento. Versões anteriores ficam com a coluna nula.
5. **Rollback.** O snapshot antigo entra como `corpus_version` nova (a numeração só cresce); a
   migração dele só precisa já ter sido aplicada no destino. A retenção protege o snapshot do lock
   vigente.
6. **`EXTRACTOR_REVISION`.** Revisão 1 = chave atual, sem sufixo (o cache das 40 partes continua
   válido); da 2 em diante, `.x<n>` antes do `.json`. Testes nos dois lados prendem a versão do
   `docling` do `uv.lock`.
7. **B4.** As redações novas começam no fechamento mais tardio das que a versão fecha: no
   reprocessamento da mesma versão, o dia seguinte ao `published_on`.
