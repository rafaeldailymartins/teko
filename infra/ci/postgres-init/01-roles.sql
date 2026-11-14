-- Roles da stack de CI, como no Neon e nos testes de integração (apps/api/test/setup/
-- postgres.global.ts): teko_owner (dono, migrações e seed), teko_app (runtime, sem DDL) e
-- teko_watch (source-watch). Senhas só da stack descartável.
CREATE ROLE teko_owner LOGIN PASSWORD 'owner-ci-only' CREATEROLE;
CREATE ROLE teko_app LOGIN PASSWORD 'app-ci-only';
CREATE ROLE teko_watch LOGIN PASSWORD 'watch-ci-only';
GRANT teko_app, teko_watch TO teko_owner WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;
ALTER DATABASE teko OWNER TO teko_owner;
GRANT ALL ON SCHEMA public TO teko_owner;

-- No Neon o owner pode criar `vector`; aqui o superusuário cria as extensões antes, e o
-- `CREATE EXTENSION IF NOT EXISTS` da migração vira no-op.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
