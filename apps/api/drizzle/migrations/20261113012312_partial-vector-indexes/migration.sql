-- Armazenamento (os vetores são ~70% do banco): a busca nunca lê conhecimento fechado
-- (`upper_inf(c.knowledge)` no mesmo WHERE do ANN e do léxico), então o vetor de um chunk fechado
-- sai e o HNSW e o GIN passam a parciais. Migração `contract` (troca de índice).
UPDATE corpus.chunks SET embedding = NULL
WHERE NOT upper_inf(knowledge) AND embedding IS NOT NULL;--> statement-breakpoint
SET LOCAL maintenance_work_mem = '256MB';--> statement-breakpoint
-- IF EXISTS: um `--bulk` que caiu no meio deixa o staging sem o HNSW.
DROP INDEX IF EXISTS "corpus"."chunks_tsv_gin";--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin" ON "corpus"."chunks" USING gin ("tsv") WHERE upper_inf("knowledge");--> statement-breakpoint
DROP INDEX IF EXISTS "corpus"."chunks_embedding_hnsw";--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "corpus"."chunks" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16, ef_construction=128) WHERE upper_inf("knowledge");
