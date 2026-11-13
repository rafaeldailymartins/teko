# Qualidade, testes e segurança

Os gates de PR ficam enxutos e rápidos; o que é caro roda no nightly, no agendado ou no
pré-release (ADR 0032). Nenhum gate de PR pode ficar vermelho num merge: o `ci-gate` agrega todos.

## Princípios

- **Uma porta por dependência externa**, cada uma com um fake determinístico em
  `adapters/out/fakes/` (`LLM_PROVIDER=fake`, `EMBEDDINGS_PROVIDER=fake`); as asserções de boot
  impedem fakes em staging e produção.
- **Stack descartável de CI** (`infra/ci/`, F4): Postgres `pgvector/pgvector` por digest (paridade
  com o pgvector do Neon) e a imagem candidata da API (builder `node:24-trixie-slim`, runtime
  distroless, nunca publicada), com `APP_ENV=ci` e os limites de uma instância Fluid (1 vCPU,
  2 GB). O estático e a API respondem na mesma origem, como na Vercel. Aceitação, e2e, k6, ZAP
  ativo, evals de geração e red team rodam só aí; os ambientes reais recebem só smoke, system test
  e ZAP baseline passivo.
- **Relógio** fixo em `2026-11-10`.

## Matriz de testes

| Tipo                | Ferramenta                                                                                 | Gatilho                                              | Gate                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Unit + propriedades | Vitest + `@vitest/coverage-v8`; fast-check + `@fast-check/vitest`                          | pre-push (afetados), PR, push                        | verde + thresholds de cobertura                       |
| Integração API      | Testcontainers + `app.inject()` sobre `buildApp`                                           | PR, push                                             | verde                                                 |
| Integração ingestão | parsers, chunker, CLI sobre Docling JSON de fixture                                        | PR em ingestão                                       | snapshots idênticos                                   |
| Python              | pytest, hypothesis, ruff (com `S`), pyright strict                                         | PR em `tools/ingest/**`                              | verde, cobertura ≥ 85%                                |
| Retrieval evals     | promptfoo sobre a fixture ([avaliação](ingestao-e-avaliacao.md#avaliação-ragops-adr-0031)) | PR em `rag`/`ingest`                                 | `thresholds.json`                                     |
| E2E                 | Playwright, 5 a 8 jornadas, Chromium + viewport mobile, axe                                | PR (se `web`/`api` afetados), na stack de CI         | verde, `forbidOnly`, 2 retries                        |
| Sistema             | Playwright `@system`                                                                       | após deploy de staging                               | bloqueia o release (`staging-verified`)               |
| Smoke               | Playwright `request` `@smoke`                                                              | após cada deploy                                     | falha → rollback                                      |
| Contrato            | OpenAPI × `uiMessageChunkSchema` × cliente gerado                                          | PR                                                   | verde                                                 |
| Desempenho          | `sql-perf` (gate); Vitest bench e autocannon (informativos)                                | PR em `api`/`rag`                                    | plano de execução e teto relativo ao runner           |
| Carga               | k6 na stack de CI: `smoke.ts` e `load.ts`                                                  | PR em `api` (smoke); pré-release (load)              | thresholds k6                                         |
| Cobertura           | v8 por pacote, thresholds do Vitest                                                        | PR                                                   | thresholds abaixo                                     |
| Mutação             | StrykerJS em `apps/api` e `packages/shared`                                                | nightly, só com commit novo desde o último run verde | break 70                                              |
| Segurança           | ver o pipeline abaixo                                                                      | PR, push, agendado, deploy                           | ver o pipeline                                        |
| Red team LLM        | promptfoo, plugins locais                                                                  | semanal, pré-release                                 | ASR ≤ 5%; 0% em extração, PII e policy                |
| Usabilidade         | axe e teclado no e2e; rodada moderada                                                      | PR (automático); 1 rodada antes da v0.1.0            | axe zero; SUS registrado (meta ≥ 80 depois da v0.1.0) |

**Cortados na revisão de 2026-11-12:** playwright-bdd gerado do OpenSpec (e o `spec-trace`),
Storybook com `addon-vitest`, Stryker no web e mutmut, k6 `stress`/`breakpoint`/`soak`/`spike`
semanais, autocannon/bench com "regressão > 15%" bloqueando, e2e em 4 shards com Firefox, WebKit e
regressão visual, Codecov. Os cenários do OpenSpec são cobertos por testes unitários e de
integração que citam o requisito.

## Configuração essencial

- **Vitest:** projects inline; JUnit em `reports/junit.xml`.
- **Banco de teste:** um container com tmpfs e `fsync=off`; cria `teko_app` e `teko_watch`, aplica
  as migrações reais e faz `snapshot()`; cada arquivo restaura o snapshot.
- **Login nos testes:** o e2e cria usuário e sessão direto no Postgres efêmero (sem endpoint HTTP)
  e cobre a passkey com autenticador virtual (CDP `WebAuthn.addCredential`); o system test usa um
  usuário persistente do staging com passkey pré-registrada (chave no environment `staging`).
- **Fakes:** `FakeEmbeddingAdapter` (lookup por hash na fixture; em `strict`, miss falha);
  `FakeLLMAdapter` com marcadores de falha (`[[fault:429]]`, `[[fault:timeout]]`, `[[fault:5xx]]`,
  `[[fault:bad-citation]]`, `[[fault:xss]]`); MSW com handlers gerados no front;
  `perf/seed/synthetic.sql` gera 100k chunks.

**Thresholds de cobertura** (linhas/branches/funções/statements):

| Pacote            | Escopo                         | Threshold                     |
| ----------------- | ------------------------------ | ----------------------------- |
| `apps/api`        | `domain/**` e `application/**` | 95/90/95/95 (`perFile`)       |
| `apps/api`        | `adapters/**`                  | 80/70/80/80                   |
| `packages/shared` | tudo                           | 95/90/95/95                   |
| `apps/web`        | `src/lib/**`                   | 90/85                         |
| `apps/web`        | global                         | 80/75, sem `app/**` e gerados |

## Gates

**Camada rápida (`pnpm verify`, pre-push e PR):** Biome sem warnings, typecheck, knip (com o passe
`--production`), dependency-cruiser, sherif, jscpd (3%, `min-tokens` 70), type-coverage ≥ 99%
`--strict`, `spec:validate`, guarda do lockfile e testes unitários. **Completa (`pnpm verify:full`):**
mais integração, testes dos scripts, build, Python, os testes de shell do CI e o audit.

**dependency-cruiser** (`apps/api/.dependency-cruiser.cjs`): `domain` só importa `zod` e
`@teko/shared`; `application` não importa `adapters`; `adapters/in` não importa `adapters/out`;
só o `composition-root.ts` importa tudo; SDKs de LLM só em `adapters/out/llm/**` e
`@vercel/functions` só em `adapters/out/platform/vercel/**`; mais `no-circular`, `no-orphans`,
`not-to-unresolvable` e `not-to-dev-dep`.

**Biome** bloqueia, em `domain/**` e `application/**`, imports de `fastify*`, `drizzle-orm*`, `pg`,
SDKs de LLM, `better-auth*`, `@vercel/*` e `#adapters/*`; no web, `next/server`, `drizzle-orm`, `pg`
e `better-auth` do lado servidor.

**SonarQube Cloud** analisa PRs e o branch principal, mas é informativo: fica fora do `ci-gate`.

**lefthook:** pre-commit com `biome check --staged --write`, gitleaks, `openspec validate` (se
`openspec/**` mudou) e a guarda do lockfile; pre-push com a camada rápida nos pacotes afetados. A
lista de escopos de commit fica num só lugar, lido pelo `pr-title`; não há hook de commit-msg.

## Segurança

| Controle            | Ferramenta                                                                                                                                      | Gatilho                                | Gate                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| SAST                | CodeQL (`javascript-typescript`, `python`; `security-extended`)                                                                                 | PR, push, semanal                      | high bloqueia (ruleset)                                     |
| Regras próprias     | Semgrep CE por digest, `.semgrep/teko.yml`                                                                                                      | PR                                     | `--error`                                                   |
| Segredos            | secret scanning + push protection; gitleaks                                                                                                     | PR, pre-commit                         | qualquer achado                                             |
| SCA no PR           | `dependency-review-action` (`fail-on-severity: low`, runtime, allowlist de licenças); `pnpm audit signatures`; Socket                           | PR                                     | qualquer achado                                             |
| SCA fora do PR      | `pnpm audit --prod` + osv-scanner (`pnpm-lock.yaml`, `uv.lock`), no `audit.yml`                                                                 | push em `main`, diário, todo deploy    | job vermelho; no deploy, bloqueia                           |
| Bundle de runtime   | Grype sobre o SBOM (syft) do `.vercel/output` e da imagem da stack de CI                                                                        | build, diário sobre produção e staging | high/critical bloqueiam o deploy e disparam hotfix em 24 h  |
| SBOM e proveniência | `pnpm sbom` + syft; `actions/attest` (provenance no tarball, depois SBOM)                                                                       | deploy e release                       | `gh attestation verify` antes do `vercel deploy --prebuilt` |
| Workflows           | SHAs pinados, `permissions: {}`, harden-runner (`audit` → `block`), `persist-credentials: false`, zizmor, actionlint; sem `pull_request_target` | PR                                     | bloqueia                                                    |
| DAST                | ZAP baseline na stack de CI; ZAP baseline passivo semanal no staging                                                                            | nightly, semanal, pré-release          | high ou medium falha                                        |
| Headers reais       | smoke (CSP, HSTS, nosniff, cookies, `no-store` em `/api`, sem `x-vercel-cache: HIT` em `/api`)                                                  | após deploy                            | rollback                                                    |
| Artefato de deploy  | `scripts/pack-vercel-output.ts`: tarball determinístico sem `.vercel/.env*` nem `project.json`, gitleaks nele                                   | todo deploy                            | bloqueia                                                    |
| Scorecard           | `scorecard-action` + bestpractices.dev                                                                                                          | push em `main`, semanal                | ≥ 7 (v0.1.0), ≥ 8 (v0.2.0)                                  |

O CodeQL de `actions` sai quando o mantenedor tirar o check `Analyze (actions)` do ruleset (zizmor
e actionlint cobrem os workflows). O ZAP API scan fica para depois da v0.1.0.

**Regras do Semgrep:** nenhum `route.ts` ou Server Action; nenhum `sql.raw(` com entrada não
literal; nenhum `dangerouslySetInnerHTML` nem `rehype-raw`; `process.env` só em `config/env.ts`;
fetch externo só pelo `SafeFetcher`.

**Política de vulnerabilidades em produção.**

1. pnpm com `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps`,
   `strictDepBuilds` e `allowBuilds` revisado; o CI falha se o SBOM listar menos de 100 pacotes.
2. Security updates do Dependabot miram o branch padrão; `pnpm audit --fix` grava `overrides` quando
   preciso.
3. **High e critical** no bundle ou no lockfile de produção disparam um release patch em até 24 h;
   as demais severidades entram no próximo release. Exceções só em `osv-scanner.toml` e
   `.grype.yaml`, com `reason`, prova de caminho não alcançável e `ignoreUntil` ≤ 30 dias.
4. Runtime: Node 24.x gerenciado pela Vercel (o `process.version` vai para o OTel); o projeto
   controla o bundle, varrido pelo Grype.

**Hardening da aplicação (ASVS L2).**

- **Sessão:** cookie `__Secure-`, `HttpOnly`, `SameSite=Lax`, first-party em `tekoia.vercel.app`,
  rotação no login, expiração idle e absoluta.
- **CSRF e stream:** `Origin` igual ao domínio do ambiente nas mutações e no stream; claim atômico
  de um stream por pergunta e 1 stream ativo por usuário; teto de 100 s.
- **IP:** `x-real-ip`, que a Vercel sobrescreve; `trustProxy` por plataforma.
- **Entrada e saída:** pergunta ≤ 1.000 caracteres, body ≤ 32 KB; markdown sem HTML cru e sem
  imagens do LLM (provado pelo e2e `[[fault:xss]]`).
- **SSRF:** o `SafeFetcher` da ingestão e do watch aceita só https e uma allowlist de hosts (a
  exceção é http na porta 80 para os Guias fixados por sha256, ADR 0028), resolve o DNS, bloqueia
  IPs privados, link-local e de metadata e revalida até 3 redirects.
- **Segredos:** GitHub Environments (CI e deploy) e env vars Sensitive da Vercel (runtime). O
  `PiiRedactor` roda antes do LLM, no `mask` do Langfuse, no erro reportado e nos logs; uma
  propriedade garante que nenhuma PII gerada sobrevive.
- **Banco:** runtime e manutenção só com `teko_app` (sem DDL); watch só com `teko_watch`.

## Modelo de ameaças (STRIDE)

| Ameaça | Vetor                                              | Mitigação                                                                                                                     | Teste                                            |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| S      | requisição cross-site usando o cookie              | `SameSite=Lax`, `Origin` exato nas mutações e no stream, `content-type: application/json`                                     | int: `Origin` errado ou ausente → 403            |
| S      | `VERCEL_TOKEN` vazado faz deploy fora da atestação | token só nos environments, revisor em produção, um token por uso, expiração de 90 dias                                        | revisão de workflow + alerta de expiração        |
| T      | injeção indireta pelo corpus                       | fontes delimitadas, canary, validação de `[Sn]`                                                                               | casos manuais + chunk envenenado                 |
| T      | XFF forjado para fugir do rate limit               | `x-real-ip` sobrescrito pela Vercel; `trustProxy` por plataforma                                                              | int                                              |
| R      | negação de consulta                                | `questions` com request id e user id                                                                                          | int                                              |
| I      | PII ao Gemini, ao Langfuse ou aos logs             | redator + mask                                                                                                                | propriedade                                      |
| I      | CDN cacheando respostas `/api` por usuário         | `private, no-store`, sem ETag                                                                                                 | int + smoke                                      |
| I      | OpenAPI ou rotas de eval expostas                  | só staging/CI; rotas de eval em plugin separado com `APP_ENV=ci`; asserção de boot                                            | int (`/api/v1/_eval/*` → 404 em staging) + smoke |
| I      | tarball do `.vercel/output` vaza Config ou segredo | `pack-vercel-output.ts` exclui `.env*` e `project.json` e roda gitleaks; Sensitive nunca entra no build                       | job de deploy                                    |
| D      | esgotar cota de LLM, neurons ou CU-h               | tetos, breaker, cache, `/healthz` sem DB                                                                                      | int + k6                                         |
| D      | abuso pausa a Vercel por 30 dias                   | WAF (deny em `/api` desconhecido, rate limit no stream), tetos de perguntas e `stream_seconds`, guarda diária com kill switch | int + `vercel-usage`                             |
| E      | fake ou rota de teste em produção                  | asserção de boot por `APP_ENV`                                                                                                | int                                              |
| E      | runtime com DDL                                    | `teko_app` só com DML/SELECT                                                                                                  | int: `DROP TABLE` → `permission denied`          |
| E      | URLs únicas e deployments antigos                  | Deployment Protection Standard; bypass de automação fora de logs e rotacionado                                                | smoke: URL única sem bypass não chega à API      |

## LGPD

- `/privacy` e `/terms` em en e pt-BR (18+, aviso de treino, política EEE/UK/CH, operadores com a
  Vercel em `gru1`); registro de tratamento em `docs/privacy/ropa.md`.
- **Retenção:** conversas 90 dias (purge semanal); logs de runtime da Vercel 1 h, sem a pergunta
  crua; logs no Grafana 14 dias; Langfuse e PostHog 30 dias onde a configuração permite; cache de
  respostas só com a chave e a pergunta redigida.
- **Vercel como operador:** opt-out de Model Training obrigatório (ADR 0004), pergunta crua nunca
  no stdout.
- **DSR:** `GET /me/export` e `DELETE /me` (cascade no Postgres, `AnalyticsErasurePort` e
  `TraceErasurePort`), SLA de 15 dias. Por causa do `cookieCache` do Better Auth, uma sessão
  revogada pode valer por até 5 min no cookie; as rotas de DSR leem a sessão do banco e a janela
  fica registrada no `ropa.md`.
