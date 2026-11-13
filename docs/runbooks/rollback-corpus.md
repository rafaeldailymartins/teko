# Runbook: rollback do corpus da produção

A produção só recebe o corpus pelo snapshot que o staging exporta (`cli snapshot promote`, job
`promote-corpus`; [ADR 0025](../adr/0025-reconciliacao-incremental-e-snapshot.md)). Quando um
snapshot promovido se mostra ruim (parser quebrado que passou pelos gates, regressão no
`corpus-eval` depois do merge do lock), a saída é **repromover um snapshot anterior como uma
versão nova do corpus**. Não se apaga nada da produção nem se volta a numeração: o histórico
bitemporal fica, e as linhas que o snapshot ruim trouxe têm o conhecimento fechado na data do
rollback.

## Antes

1. Escolha o snapshot bom: em geral, o `snapshot.corpusVersion` do `corpus/corpus.lock.json`
   anterior ao PR do lock ruim (`git log -p corpus/corpus.lock.json`). A linhagem do lock e do
   `manifest.json` (`lineage`: commit, modelo de embedding, revisões do parser e do extrator,
   reranker) ajuda a achar a última versão sã.
2. Confira que o snapshot ainda está no store `corpus-snapshots`. A exportação guarda os 3 mais
   recentes **e o do lock vigente** no momento de cada exportação (`protect`), então o snapshot que
   a produção tinha antes do último PR do lock continua lá. Se ele já saiu, não há rollback por
   snapshot: reingira o staging na revisão boa e promova o snapshot novo.
3. A migração do snapshot precisa já ter sido aplicada na produção (o `promote --rollback` confere
   no `drizzle.__drizzle_migrations`). O formato lê snapshots anteriores às colunas novas
   (`parser_revision`, `gap_entries`); uma migração que mude o significado de uma coluna exige
   reingerir em vez de voltar.

## Rollback

Com a URL do owner da produção (`NEON_PROD_MIGRATE_URL`, environment `production`) no
`DATABASE_URL` e o backend do store configurado como no `promote-corpus`:

```bash
pnpm --filter @teko/api cli snapshot promote --corpus-version <N> --rollback
```

A saída é uma linha JSON com a `corpusVersion` nova (a maior da produção mais 1), as contagens por
tabela e `"rollback": true`. O que acontece, numa transação:

- redações e chunks abertos da produção que não estão no snapshot têm o conhecimento fechado hoje
  (e os chunks perdem o vetor);
- as do snapshot voltam abertas, com o vetor do snapshot (0 neurons);
- a cobertura vem do snapshot, com o `verified_at` mais recente dos dois e as lacunas detectadas
  depois da exportação do snapshot (A1);
- `corpus_versions` ganha a linha `rollback para o snapshot <N> (...)`, e a cobertura das famílias
  do snapshot aponta para ela.

Sem `--rollback`, a promoção de um snapshot mais antigo que a produção é recusada; com
`--rollback`, a de um snapshot que não é mais antigo também.

## Depois

1. Rode o `/healthz` e as retrieval evals contra a produção (o `corpus-eval` do staging não serve:
   o staging continua na versão ruim).
2. Corrija a causa no código (parser, extrator) com a revisão incrementada (ADR 0026 e
   `EXTRACTOR_REVISION`) e reingira o staging. O staging continua numerando a partir da versão dele;
   **o próximo snapshot só é promovível quando a versão do staging passar a do rollback** (a promoção
   recusa snapshot mais antigo que o destino). Se for preciso, um run do staging sem mudança não
   gera versão: a correção é que gera.
3. O PR do lock seguinte leva o snapshot novo; não edite o `corpus.lock.json` à mão para apontar
   para o snapshot do rollback.
