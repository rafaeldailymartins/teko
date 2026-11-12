ALTER TABLE "corpus"."ingestion_runs" ADD COLUMN "neurons" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD COLUMN "provision_version_id" uuid;--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD COLUMN "stable_key" text;--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD COLUMN "note_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "review_queue_open_note" ON "corpus"."review_queue" ("stable_key","note_hash") WHERE "status" = 'open';--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD CONSTRAINT "review_queue_provision_version_id_provision_versions_id_fkey" FOREIGN KEY ("provision_version_id") REFERENCES "corpus"."provision_versions"("id");--> statement-breakpoint
ALTER TABLE "corpus"."review_queue" ADD CONSTRAINT "review_queue_document_version_id_document_versions_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "corpus"."document_versions"("id");