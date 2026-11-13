ALTER TABLE "corpus"."coverage" ADD COLUMN "gap_entries" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Lacunas gravadas antes do registro por entrada: uma entrada por trecho de `gaps`, sem documento
-- (qualquer publicação da família resolve) e sem instante de detecção (vale como anterior a
-- qualquer snapshot), com o `gap_reason` de antes.
UPDATE corpus.coverage SET gap_entries = (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'sources', '[]'::jsonb,
    'from', coalesce(lower(r)::text, '0001-01-01'),
    'to', upper(r)::text,
    'detectedAt', NULL,
    'reason', coalesce(gap_reason, 'lacuna anterior ao registro por entrada')
  ) ORDER BY lower(r)), '[]'::jsonb)
  FROM unnest(gaps) AS r
) WHERE NOT isempty(gaps);
--> statement-breakpoint
-- O mark-coverage grava a entrada junto com `gaps` e `gap_reason` (que são a soma das entradas).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teko_watch') THEN
    GRANT UPDATE (gap_entries) ON corpus.coverage TO teko_watch;
  END IF;
END
$$;
