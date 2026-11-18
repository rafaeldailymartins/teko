# Tasks

## 1. Smoke

- [x] 1.1 `scripts/smoke.ts`: contrato fixo (`--env`, `--mode`, `--base-url`, `--expected-sha`, `--out`; saídas 0/1/2), checagens dos modos `deployment` e `canonical`, bypass por header só para a URL única do projeto, retry do `/healthz` só no canônico, relatório JSON e resumo do job — `scripts/smoke.test.ts` com servidor HTTP local
- [x] 1.2 `.github/workflows/smoke.yml`: `workflow_call` e `workflow_dispatch` (`environment`, `expected-sha`), sem environment, harden-runner em `block` com os domínios dos dois projetos, relatório como artifact

## 2. System test

- [x] 2.1 `apps/web/system/support/passkey.ts` (autenticador virtual, importação com contador crescente, exportação) e `apps/web/system/support/plan.ts` (pergunta e datas) — `apps/web/test/system-support.test.ts`
- [x] 2.2 `apps/web/system/questions.json` (pool de 30) e `apps/web/system/staging.spec.ts`: passkey, stream até o `finish`, cache, recusa fora da cobertura e troca de idioma; `apps/web/playwright.system.config.ts` e `test:system`
- [x] 2.3 `.github/workflows/system-test.yml`: environment `staging`, só `main`, `SYSTEM_TEST_PASSKEY` ausente → aviso e verde, conferência do sha
- [x] 2.4 `apps/web/system/register-passkey.ts` e o runbook `docs/runbooks/system-test.md`
- [x] 2.5 E2E `apps/web/e2e/passkey.spec.ts` (cadastrar, exportar, importar e entrar em dois "runs") e helpers de conta compartilhados com o `email-auth.spec.ts`

## 3. Configuração e documentação

- [x] 3.1 Invariantes dos dois workflows no `.github/scripts/ci-config.test.sh` e `system-test.yml` na exceção `self-repository` do zizmor; knip e tsconfig do web com `system/`
- [x] 3.2 `docs/architecture/ci-cd-e-ambientes.md` (Smoke, System test, tabela de workflows e segredo do staging) e `qualidade-e-seguranca.md` (matriz de testes)
