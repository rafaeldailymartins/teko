# Proposal

## Why

A revisão de arquitetura de 2026-11-12 (aprovada pelo mantenedor antes da F4) achou defeitos na
ingestão, no armazenamento e na promoção que já afetam o staging ou vão afetar a produção:

- a promoção mantinha a lacuna de cobertura da produção para sempre (o `mark-coverage` avança o
  `verified_at` dela todo dia, e a regra decidia por ele);
- o orçamento de neurons contava o dia de São Paulo (a cota zera às 00:00 UTC) e a cota esgotada
  (HTTP 429, código 3036) virava erro com retry, e o `load` saía com 1;
- a guarda de 800 MB só olhava o tamanho antes de cada versão, não o que a versão ia gravar;
- nada impedia uma versão quebrada de fechar boa parte do corpus de uma vez, nem o run de
  publicar um corpus menor que o anterior;
- os vetores (a maior parte do banco) ficavam nos chunks fechados, nos índices e no snapshot,
  embora a busca nunca os leia; o `embedding_cache` só crescia;
- uma fonte `live` regravada sem mudar virava versão nova, com fontes e raw novos;
- não havia como voltar a produção a um snapshot anterior, nem linhagem no lock.

## What Changes

- Orçamento por dia UTC; cota diária do Workers AI vira `budget_exhausted` (código 75).
- Guarda prospectiva: `tamanho + chunksNovos × bytesPorChunk > limite` aborta antes de embutir.
- Disjuntor de mudança em massa por versão de documento e gate de saúde do corpus no fim do
  `load`, liberáveis por `--accept-churn`.
- Vetor só em chunk de conhecimento aberto: apagado ao fechar (ingestão e promoção), HNSW e GIN
  parciais, snapshot sem o vetor de chunk fechado e poda do `embedding_cache` em run verde.
- Impressão digital do resultado parseado: sha256 novo com o mesmo conteúdo volta `unchanged`.
- Linhagem no manifesto e no lock; rollback (`snapshot promote --rollback`) e retenção que guarda
  o snapshot do lock vigente.
- Lacunas da cobertura por entrada (`gap_entries`): limpas só pela fonte que as causou e, na
  promoção, decididas pela data de detecção (os requisitos do watch ficam na mudança
  `add-source-change-monitoring`, ainda aberta; aqui só os de `specs/`).
- `EXTRACTOR_REVISION` na chave do cache do Docling e no `manifest.json` do `tools/ingest`.

## Capabilities

### Modified Capabilities

- `embedding-pipeline`: orçamento, guarda, reingestão, cobertura, snapshot e promoção; disjuntor,
  gate de saúde, vetor só no conhecimento aberto e rollback.
- `corpus-schema`: o `teko_watch` também atualiza `gap_entries`.
- `docling-extraction`: revisão do extrator no manifesto e na chave do cache.
- `corpus-ingestion`: o `load` com `--accept-churn`, `--max-pending-share`, uma linha por item e
  sem cobertura em run que falhou.

## Impact

- Migrações `coverage-gap-entries`, `partial-vector-indexes` (**contract**: troca os dois índices) e
  `content-fingerprint`.
- `docling-generic` na revisão 2 (tabelas): o próximo ingest reprocessa os documentos dele.
- O `ingest.yml` precisa expor `accept_churn` (e opcionalmente `max_pending_share`) no `load`, e o
  futuro `promote-corpus` precisa do `rollback`.
