---

status: accepted
date: 2026-11-14
decision-makers: Rafael Daily Santos Martins
---

# 0008 — Embeddings `bge-m3` do Workers AI, gravados como `halfvec(1024)`

## Contexto e problema

A busca híbrida (ADR 0010) precisa de um braço semântico em português, com perguntas também em
inglês, sobre um corpus de dezenas de milhares de chunks, dentro do Neon Free (0,5 GB por projeto)
e sem serviço pago. O uso já está descrito nas ADRs 0010 (busca) e 0027 (reranker); falta registrar
a escolha do modelo e do formato de armazenamento.

## Decisão

1. **`@cf/baai/bge-m3` pelo Workers AI**, por REST, com host fixo, lotes de 50 e concorrência 2. É
   multilíngue (português e inglês no mesmo espaço), tem 1.024 dimensões e cabe na cota gratuita da
   conta (10 mil neurons por dia; cerca de 1.075 neurons por milhão de tokens, medidos no spike F1
   (f)). O custo real de cada chamada (`result.meta.neurons` ou o header `cf-ai-neurons`) é somado
   contra o orçamento da ingestão por dia UTC.
2. **`halfvec(1024)` no Postgres**, com índice HNSW parcial (`halfvec_cosine_ops`, `m = 16`,
   `ef_construction = 128`, só conhecimento aberto) e iterative scan na consulta (ADR 0010). Meia
   precisão corta pela metade o espaço dos vetores, que são a maior parte do banco, sem perda
   mensurável nas retrieval evals.
3. **Texto embutido com contexto:** `heading_path` + conteúdo do chunk (contextual chunk
   embedding). O conteúdo gravado e citado continua só o do chunk. O `embedding_cache` é indexado
   pelo hash desse texto e pelo modelo: reingerir sem mudança de texto não gasta neurons.
4. **A pergunta usa o mesmo modelo**, com teto de 3 s; falha ou teto degradam para
   `lexical_only`, rotulado no `data-meta`, sem falhar a pergunta.
5. **Fake determinístico nos testes e no CI:** a fixture traz os vetores reais (`embeddings.json.gz`,
   regenerados por `fixtures-embed.ts`); o modo `strict` das evals falha num texto fora da fixture,
   e fora dele um miss vira um vetor unitário determinístico.

## Consequências

- Bom: custo zero, um provedor só para embeddings e reranker (a mesma conta e a mesma cota), e o
  vetor da pergunta e o dos chunks no mesmo modelo.
- Bom: trocar de modelo é mudar `embedding_model` e reembutir; o cache por modelo evita misturar
  vetores de modelos diferentes.
- Ruim: a ingestão completa de um corpus novo pode passar de um dia de cota; o run para como
  `budget_exhausted` e o seguinte retoma do cache.
- Ruim: o contexto do embedding é o caminho de títulos, não o texto do dispositivo-pai; o pai entra
  na consulta, pelo reranker e pelo prompt (adendo da ADR 0027).
- Neutro: `halfvec` exige pgvector 0.7 ou mais novo (o Neon e a imagem dos testes já têm).

## Confirmação

- `apps/api/src/adapters/out/embeddings/workers-ai/workers-ai-embedding-adapter.ts` e os testes
  dele (forma `[n, 1024]`, custo, cota esgotada).
- `apps/api/src/adapters/out/persistence/drizzle/schema/corpus.ts` (`halfvec`, HNSW parcial) e o
  `sql-perf`, que confere o HNSW sob filtro.
- `corpus-eval` (ADR 0031) no corpus real do staging.

## Mais informações

- Spike F1 (f) na [ADR 0003](0003-f1-spikes.md), [ADR 0010](0010-busca-hibrida-rrf.md) e
  [ADR 0027](0027-reranker-workers-ai.md).
- Fontes Context7 consultadas em 2026-11-14: `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt`
  (catálogo, preço em neurons por modelo).
