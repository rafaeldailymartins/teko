-- Extensões, função de unaccent imutável e schemas sem tabelas no Drizzle. Roda antes das tabelas:
-- a coluna gerada `corpus.chunks.tsv` depende de `public.immutable_unaccent`.
-- Tudo idempotente (IF NOT EXISTS / OR REPLACE): o Neon já traz algumas extensões em alguns planos.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- `unaccent(text)` é STABLE (depende do search_path para achar o dicionário); com o dicionário
-- qualificado ela pode ser IMMUTABLE e entrar em coluna gerada e índice.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint
-- O schema `auth` é do Better Auth (gerado na F4); existe desde já para os grants abaixo e para o
-- ALTER DEFAULT PRIVILEGES valerem para as tabelas que vierem.
CREATE SCHEMA IF NOT EXISTS auth;
