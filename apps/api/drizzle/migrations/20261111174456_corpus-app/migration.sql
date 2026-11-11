CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "corpus";
--> statement-breakpoint
CREATE TABLE "app"."answer_cache" (
	"cache_key" text PRIMARY KEY,
	"answer" jsonb NOT NULL,
	"corpus_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."feedback" (
	"question_id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_rating" CHECK ("rating" IN ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "app"."questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question_redacted" text NOT NULL,
	"locale" text NOT NULL,
	"families" text[] NOT NULL,
	"reference_date" date NOT NULL,
	"reference_source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"refusal_reason" text,
	"answer_md" text,
	"citations" jsonb,
	"retrieval" jsonb,
	"retrieval_mode" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"corpus_version" integer,
	"cache_key" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"shadow_cost_usd" numeric(10,6) DEFAULT '0' NOT NULL,
	"ttft_ms" integer,
	"latency_ms" integer,
	"langfuse_trace_id" text,
	"stream_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_status" CHECK ("status" IN ('pending', 'streaming', 'answered', 'refused', 'failed', 'aborted', 'expired')),
	CONSTRAINT "questions_refusal_reason" CHECK ("refusal_reason" IS NULL OR "refusal_reason" IN ('out_of_coverage', 'no_evidence', 'model_insufficient', 'citation_invalid'))
);
--> statement-breakpoint
CREATE TABLE "app"."rate_limits" (
	"key" text,
	"window_start" timestamp with time zone,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "app"."usage_daily" (
	"day" date,
	"scope" text,
	"requests" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"neurons" integer DEFAULT 0 NOT NULL,
	"langfuse_units" integer DEFAULT 0 NOT NULL,
	"stream_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_pkey" PRIMARY KEY("day","scope")
);
--> statement-breakpoint
CREATE TABLE "corpus"."amendments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_label" text NOT NULL,
	"act_kind" text NOT NULL,
	"act_date" date NOT NULL,
	"effective" daterange NOT NULL,
	"change_kind" text NOT NULL,
	"raw_note" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."chunk_sources" (
	"chunk_id" uuid,
	"document_version_id" uuid,
	CONSTRAINT "chunk_sources_pkey" PRIMARY KEY("chunk_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "corpus"."chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"provision_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"family" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"citation_label" text NOT NULL,
	"heading_path" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"valid_during" daterange NOT NULL,
	"knowledge" daterange NOT NULL,
	"modality" text NOT NULL,
	"review_status" text NOT NULL,
	"corpus_version" integer NOT NULL,
	"tsv" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('pg_catalog.portuguese', public.immutable_unaccent(coalesce("corpus"."chunks"."heading_path", ''))), 'A') || setweight(to_tsvector('pg_catalog.portuguese', public.immutable_unaccent("corpus"."chunks"."content")), 'B')) STORED NOT NULL,
	"embedding" halfvec(1024),
	"embedding_model" text,
	CONSTRAINT "chunks_provision_version_ordinal" UNIQUE("provision_version_id","ordinal"),
	CONSTRAINT "chunks_valid_during" CHECK (NOT isempty("valid_during") AND NOT lower_inf("valid_during")),
	CONSTRAINT "chunks_jurisdiction" CHECK ("jurisdiction" IN ('BR', 'GO'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."corpus_versions" (
	"id" serial PRIMARY KEY,
	"run_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."coverage" (
	"family" text PRIMARY KEY,
	"jurisdiction" text NOT NULL,
	"covered" datemultirange NOT NULL,
	"verified_at" date NOT NULL,
	"corpus_version" integer NOT NULL,
	"gaps" datemultirange DEFAULT '{}' NOT NULL,
	"gap_reason" text,
	CONSTRAINT "coverage_jurisdiction" CHECK ("jurisdiction" IN ('BR', 'GO'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"document_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"published_on" date NOT NULL,
	"valid_during" daterange NOT NULL,
	"consolidated_until" text,
	"act_ref" text,
	"sha256" text NOT NULL UNIQUE,
	"blob_raw" text,
	"blob_docling" text,
	"status" text DEFAULT 'ingesting' NOT NULL,
	"ingestion_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_status" CHECK ("status" IN ('ingesting', 'published', 'superseded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" text NOT NULL UNIQUE,
	"family" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"title" text NOT NULL,
	"issuer" text NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_jurisdiction" CHECK ("jurisdiction" IN ('BR', 'GO'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."embedding_cache" (
	"content_hash" text,
	"model" text,
	"embedding" halfvec(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_pkey" PRIMARY KEY("content_hash","model")
);
--> statement-breakpoint
CREATE TABLE "corpus"."ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"target" text NOT NULL,
	"git_sha" text NOT NULL,
	"status" text NOT NULL,
	"docs" integer DEFAULT 0 NOT NULL,
	"chunks_new" integer DEFAULT 0 NOT NULL,
	"neurons_est" integer DEFAULT 0 NOT NULL,
	"cu_seconds" numeric(12,3),
	"db_bytes" bigint,
	"report" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_runs_status" CHECK ("status" IN ('running', 'succeeded', 'failed', 'budget_exhausted')),
	CONSTRAINT "ingestion_runs_target" CHECK ("target" IN ('staging', 'production', 'fixture'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."provision_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"provision_id" uuid NOT NULL,
	"label" text NOT NULL,
	"valid_during" daterange NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."provision_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"provision_id" uuid NOT NULL,
	"display_label" text NOT NULL,
	"valid_during" daterange NOT NULL,
	"knowledge" daterange NOT NULL,
	"modality" text DEFAULT 'mandatory' NOT NULL,
	"validity_basis" text NOT NULL,
	"retroactive" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'auto' NOT NULL,
	"text" text NOT NULL,
	"structured" jsonb,
	"amendment_id" uuid,
	"content_hash" text NOT NULL,
	CONSTRAINT "provision_versions_modality" CHECK ("modality" IN ('optional', 'mandatory')),
	CONSTRAINT "provision_versions_review_status" CHECK ("review_status" IN ('auto', 'approved', 'pending', 'rejected')),
	CONSTRAINT "provision_versions_validity_basis" CHECK ("validity_basis" IN ('legal_effect', 'leiaute_period', 'publication_approx', 'table_declared')),
	CONSTRAINT "provision_versions_valid_during" CHECK (NOT isempty("valid_during") AND NOT lower_inf("valid_during")),
	CONSTRAINT "provision_versions_knowledge" CHECK (NOT isempty("knowledge"))
);
--> statement-breakpoint
CREATE TABLE "corpus"."provisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"stable_key" text NOT NULL UNIQUE,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"sort_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."review_queue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"run_id" uuid,
	"provision_id" uuid,
	"reason" text NOT NULL,
	"raw_note" text,
	"proposed" daterange,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_queue_status" CHECK ("status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX "answer_cache_expires" ON "app"."answer_cache" ("expires_at");--> statement-breakpoint
CREATE INDEX "questions_user_created" ON "app"."questions" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "questions_conversation" ON "app"."questions" ("conversation_id");--> statement-breakpoint
CREATE INDEX "questions_cache_key" ON "app"."questions" ("cache_key");--> statement-breakpoint
CREATE INDEX "rate_limits_expires" ON "app"."rate_limits" ("expires_at");--> statement-breakpoint
CREATE INDEX "chunk_sources_document_version" ON "corpus"."chunk_sources" ("document_version_id");--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin" ON "corpus"."chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "corpus"."chunks" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16, ef_construction=128);--> statement-breakpoint
CREATE INDEX "chunks_family_valid_during_gist" ON "corpus"."chunks" USING gist ("family","valid_during");--> statement-breakpoint
CREATE INDEX "document_versions_document" ON "corpus"."document_versions" ("document_id");--> statement-breakpoint
CREATE INDEX "provision_labels_provision" ON "corpus"."provision_labels" ("provision_id");--> statement-breakpoint
CREATE INDEX "provision_versions_provision" ON "corpus"."provision_versions" ("provision_id");--> statement-breakpoint
CREATE INDEX "provisions_stable_key_trgm" ON "corpus"."provisions" USING gin ("stable_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "provisions_document" ON "corpus"."provisions" ("document_id");--> statement-breakpoint
ALTER TABLE "app"."feedback" ADD CONSTRAINT "feedback_question_id_questions_id_fkey" FOREIGN KEY ("question_id") REFERENCES "app"."questions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "corpus"."chunk_sources" ADD CONSTRAINT "chunk_sources_chunk_id_chunks_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "corpus"."chunks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "corpus"."chunk_sources" ADD CONSTRAINT "chunk_sources_document_version_id_document_versions_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "corpus"."document_versions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."chunks" ADD CONSTRAINT "chunks_provision_version_id_provision_versions_id_fkey" FOREIGN KEY ("provision_version_id") REFERENCES "corpus"."provision_versions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."corpus_versions" ADD CONSTRAINT "corpus_versions_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "corpus"."ingestion_runs"("id");--> statement-breakpoint
ALTER TABLE "corpus"."document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "corpus"."documents"("id");--> statement-breakpoint
ALTER TABLE "corpus"."document_versions" ADD CONSTRAINT "document_versions_ingestion_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "corpus"."ingestion_runs"("id");--> statement-breakpoint
ALTER TABLE "corpus"."provision_labels" ADD CONSTRAINT "provision_labels_provision_id_provisions_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "corpus"."provisions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."provision_versions" ADD CONSTRAINT "provision_versions_provision_id_provisions_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "corpus"."provisions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."provision_versions" ADD CONSTRAINT "provision_versions_amendment_id_amendments_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "corpus"."amendments"("id");--> statement-breakpoint
ALTER TABLE "corpus"."provisions" ADD CONSTRAINT "provisions_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "corpus"."documents"("id");--> statement-breakpoint
ALTER TABLE "corpus"."provisions" ADD CONSTRAINT "provisions_parent_id_provisions_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "corpus"."provisions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD CONSTRAINT "review_queue_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "corpus"."ingestion_runs"("id");--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD CONSTRAINT "review_queue_provision_id_provisions_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "corpus"."provisions"("id");