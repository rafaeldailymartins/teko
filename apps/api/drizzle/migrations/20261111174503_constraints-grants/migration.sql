-- Restrições que o Drizzle não expressa e grants de privilégio mínimo. O drizzle-kit aplica cada
-- migração uma vez; o bloco de grants só age sobre roles que já existem, então os roles são
-- criados ANTES da primeira migração de cada projeto Neon (`scripts/neon-roles.ts`, runbook
-- `docs/runbooks/neon-roles.md`).

-- Sem sobreposição de redações publicáveis do mesmo dispositivo e modalidade. Versões `pending`
-- (anomalias da review_queue) e `rejected` ficam de fora, para que a anomalia não aborte a
-- transação do documento; versões com `knowledge` fechado (substituídas) também.
ALTER TABLE corpus.provision_versions ADD CONSTRAINT pv_no_overlap
  EXCLUDE USING gist (provision_id WITH =, modality WITH =, valid_during WITH &&)
  WHERE (upper_inf(knowledge) AND review_status IN ('auto', 'approved'));
--> statement-breakpoint
-- O PgBouncer do Neon (-pooler) não aceita SET de sessão nem `statement_timeout` em `options`
-- (spike F1 (d)): os timeouts ficam no role. Os roles de login são criados fora das migrações
-- (API do Neon, `scripts/neon-roles.ts`; no teste, `test/setup/postgres.global.ts`), com senha
-- gerada pelo Neon; aqui só se configura e concede. O ALTER DEFAULT PRIVILEGES vale para objetos
-- criados pelo owner que roda o `drizzle-kit migrate`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teko_app') THEN
    ALTER ROLE teko_app SET statement_timeout = '5s';
    ALTER ROLE teko_app SET idle_in_transaction_session_timeout = '5s';
    GRANT USAGE ON SCHEMA app, auth, corpus TO teko_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app, auth TO teko_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA app, auth TO teko_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA corpus TO teko_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO teko_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth GRANT USAGE ON SEQUENCES TO teko_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA corpus GRANT SELECT ON TABLES TO teko_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teko_watch') THEN
    GRANT USAGE ON SCHEMA corpus TO teko_watch;
    -- `gaps` acompanha `gap_reason`: o mark-coverage grava o trecho a partir da data de efeito
    -- detectada, e o CheckCoverage o subtrai da cobertura.
    GRANT SELECT, UPDATE (verified_at, gaps, gap_reason) ON corpus.coverage TO teko_watch;
  END IF;
END
$$;
