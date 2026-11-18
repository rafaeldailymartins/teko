-- Os roles de login passaram a ser criados por SQL pelo owner (`scripts/neon-roles.ts`, ADR 0040):
-- os da API do Neon eram membros do `neon_superuser` e o owner não tinha ADMIN sobre eles. Um role
-- recriado depois das migrações que o configuravam (`*_constraints-grants` e
-- `*_coverage-gap-entries`) fica sem grants nem timeouts, então este bloco os reaplica. Tudo aqui é
-- idempotente: no banco em que o role já estava configurado, nada muda.
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
    GRANT SELECT, UPDATE (verified_at, gaps, gap_reason, gap_entries) ON corpus.coverage TO teko_watch;
  END IF;
END
$$;
