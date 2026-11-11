# Tasks

## 1. Ferramentas da raiz e supply chain

- [x] 1.1 Criar `package.json`, `pnpm-workspace.yaml` (catálogo estrito e hardening), `turbo.json`, `tsconfig.base.json`, `biome.json`, `.editorconfig`, `.gitattributes` e `.nvmrc`, e conferir com `pnpm install --frozen-lockfile`
- [x] 1.2 Criar `scripts/check-lockfile.ts` e conferir que `node scripts/check-lockfile.ts` termina com 0 no lockfile atual
- [x] 1.3 Registrar exceções e versões seguradas em `docs/adr/0002-supply-chain-pnpm.md` e conferir que cada exceção do `pnpm-workspace.yaml` aparece na ADR
- [x] 1.4 Configurar `lefthook.yml` (binários via `./node_modules/.bin`), `commitlint.config.mjs`, `knip.json` (dois modos no script `pnpm knip`), `cliff.toml` e `.jscpd.json`
- [x] 1.5 Fixar `@vercel/functions` em 3.7.6 no catálogo (última versão com proveniência SLSA) e conferir que o `pnpm-workspace.yaml` da raiz não tem exceção para `vercel` nem `@vercel/*`
- [x] 1.6 Criar o projeto isolado `tools/vercel-cli` (Vercel CLI 65.11.0, lockfile próprio, exceções `vercel`, `@vercel/*`, `undici@5.29.0`, `semver@6.3.1`, `allowBuilds` negando `esbuild` e `koffi`) e conferir que cada exceção aparece na ADR 0002
- [x] 1.7 Corrigir o `.gitignore` (`out/` → `/apps/web/out/`) e conferir com `git check-ignore -v apps/api/src/adapters/out` sem saída
- [x] 1.8 Registrar a troca da VM Oracle pelo Vercel Hobby na ADR 0004 e sincronizar a ADR 0001, o README, o CONTRIBUTING, o `SECURITY.md` e o `openspec/config.yaml`, e conferir com `grep -rniE "oracle|dedyn|desec|cloud-init" docs openspec README*.md CONTRIBUTING.md SECURITY.md` (a VM só aparece como opção descartada ou histórico: ADRs 0001, 0003 e 0004 e o texto das mudanças)

## 2. Pacotes do workspace

- [x] 2.1 Implementar `@teko/shared` (`contracts`, `errors`, `vigencia`, `pii`, `analytics`, `i18n`) e conferir com `pnpm --filter @teko/shared test:unit` e `typecheck`
- [x] 2.2 Criar o esqueleto de `apps/api` (sem rotas de negócio) e conferir com `pnpm --filter @teko/api typecheck`
- [x] 2.3 Criar o esqueleto de `apps/web` com export estático e conferir com `pnpm --filter @teko/web build` (0 functions)
- [x] 2.4 Criar `tools/ingest` (Python + uv, `exclude-newer = "7 days"`) e conferir com `uv run --frozen pytest`
- [x] 2.5 Criar `apps/api/vercel.json` (`regions: ["gru1"]`, `fluid: true`, `git.deploymentEnabled: false`) e o `.vercel/output` da Function a partir do bundle do tsdown (`scripts/build-vercel-output.ts`, ADR 0017; o zero-config quebrou no spike (b)) e conferir com o deploy do spike (b)

## 3. Stack local

- [x] 3.1 Escrever `scripts/dev-secrets.ts` e conferir: primeira execução cria as chaves, a segunda não altera nada (hash igual), token forjado é reassinado sem tocar os segredos
- [x] 3.2 Escrever `infra/local/compose.yaml` e `infra/local/Caddyfile` e conferir com `docker compose -f infra/local/compose.yaml config --quiet` e `caddy validate`
- [x] 3.3 Subir a stack com `up -d --wait` e conferir Postgres 18 + `vector` 0.8.6 e o proxy: `x-nf-sign` válido, header forjado sobrescrito, 413 acima de 32 KB, 404 fora de `/api`
- [x] 3.4 Subir o profile `langfuse` e conferir `/api/public/health` = 200 e as chaves geradas autenticando em `/api/public/projects`
- [x] 3.5 Documentar o setup local no `CONTRIBUTING.md` (`corepack enable` ou `corepack pnpm`, `TEKO_TMP`, hooks, knip, `tools/vercel-cli`, regra do uv) e conferir que os comandos documentados rodam como escritos

## 4. Spikes da F1

Todos os spikes rodaram com tokens reais e têm resultado na ADR 0003 (fechada em 2026-11-11).
Nenhum resultado foi presumido.

- [x] 4.1 Spike (a): build do Next no Actions + `netlify deploy --build --context develop --alias develop` com 0 functions e env por contexto, registrado em `docs/adr/0003-f1-spikes.md`
- [x] 4.2 Spike (b): Fastify "hello" com o `server.ts` real no `teko-api-staging` pelo fluxo do CI (tsdown → `scripts/build-vercel-output.ts` → tarball atestado → `vercel deploy --prebuilt --prod --skip-domain` → `vercel curl` → `vercel promote`), com o checklist da ADR 0003
- [x] 4.3 Spike (c): plugin `context-routing` contra uma rota de echo no `teko-api-staging.vercel.app`, com o checklist da ADR 0003
- [x] 4.4 Spike (d): Neon `-pooler` com timeouts por role, `attachDatabasePool` e reconexão após scale-to-zero (o `attachDatabasePool` fica para a F2, com a decisão do driver; ADR 0003)
- [x] 4.5 Spike (e): exports `parseJsonEventStream` e `uiMessageChunkSchema` do `ai`, registrado na ADR 0003 (presentes em 7.0.162 e 7.0.169)
- [x] 4.6 Spike (f): Docling ACCURATE contra V2 no Guia 3.2.4, formato do WS de Tabelas Externas, `bge-m3` com dimensão 1024 e plugins locais do promptfoo (ADR 0003, "Spike (f)")
- [ ] 4.7 Spike (g): concluir a conferência via Context7 de todas as versões das tabelas de ferramentas e de stack e registrar na ADR 0003 (parcial: catálogo, proveniência, Vercel, uv, `ai`, OpenSpec, pnpm, Turborepo, Biome, imagens locais e, no spike (f), Docling, Workers AI e promptfoo; as bibliotecas ainda não introduzidas são conferidas pelas fases que as introduzem)
- [x] 4.8 Ajustar plano e ADRs com as decisões dos spikes (allowlist de `deploy_context`, header de IP, formato do entrypoint e do build, glob de `supportsCancellation`, `trustProxy` da Vercel, versões) e passar a ADR 0003 a `accepted`

## Workflow follow-up

- Arquivar a mudança (`openspec archive scaffold-monorepo --yes`) quando os grupos 2 e 4 estiverem concluídos.
