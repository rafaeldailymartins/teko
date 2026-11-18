# deploy-verification Specification

## Purpose

Define como o Tekó prova que uma deployment responde como a arquitetura manda: o smoke HTTP da URL
única e do domínio canônico de cada ambiente, e o system test do staging com o usuário de teste
entrando por passkey.

## Requirements

### Requirement: Smoke com contrato fixo

`scripts/smoke.ts` MUST aceitar só `--env staging|production`, `--mode deployment|canonical`,
`--base-url`, `--expected-sha` (40 caracteres hexadecimais minúsculos) e `--out` opcional
(`.json`, dentro do repositório), e SHALL sair com 0 quando todas as checagens passam, 1 quando
alguma falha e 2 em argumento inválido, sem fazer request nenhum.

#### Scenario: Relatório fora do repositório

- **WHEN** `--out` aponta para um caminho que, resolvido, fica fora do repositório
- **THEN** o smoke sai com 2 sem gravar nada

### Requirement: Alvo do smoke amarrado ao ambiente

No modo `canonical`, a `--base-url` MUST ser o `WEB_ORIGIN` de `infra/vercel/env.<env>.json`; no
`deployment`, uma URL única `https://<projeto>-<...>.vercel.app` do projeto do ambiente, sem
caminho, porta nem query, e na produção nunca uma URL do staging.

#### Scenario: Smoke de produção apontado para o staging

- **WHEN** o smoke roda com `--env production --mode canonical --base-url https://tekoia-staging.vercel.app`
- **THEN** ele sai com 2 sem fazer request

### Requirement: Smoke da URL única com o bypass de automação

No modo `deployment`, o smoke MUST mandar o header `x-vercel-protection-bypass` com o valor de
`VERCEL_AUTOMATION_BYPASS_SECRET` (só do ambiente do processo) em cada checagem, nunca imprimir nem
gravar esse valor, e SHALL conferir que a mesma URL sem o header não chega à API (401, 403 ou
redirect para outro host). Sem o segredo, o smoke MUST sair com 2.

#### Scenario: URL única sem proteção

- **WHEN** a URL única responde ao `/healthz` sem o header de bypass
- **THEN** a checagem `deployment-protection` falha e o smoke sai com 1

#### Scenario: Segredo fora da saída

- **WHEN** o smoke termina, verde ou vermelho
- **THEN** nem o stdout, nem o relatório JSON, nem o resumo do job contêm o valor do bypass

### Requirement: Checagens do smoke sem LLM

O smoke MUST conferir, sem sessão e sem gerar resposta: `/healthz` e `/api/healthz` com o
`gitSha` esperado e o `env` do ambiente; o redirect 302 da raiz pelo `Accept-Language`; `/pt-BR/` e
`/en/` com os headers de segurança do estático e a CSP do documento; duas leituras de
`/api/v1/coverage` sem cache da CDN; o stream sem sessão (401) e com `Origin` de outro site (403).
O relatório MUST trazer, de cada checagem, o status, o número de tentativas e o tempo.

#### Scenario: CDN cacheando a API

- **WHEN** `/api/v1/coverage` volta com `x-vercel-cache: HIT`
- **THEN** a checagem de cobertura falha e o smoke sai com 1

### Requirement: WAF e domínio antigo no smoke canônico

No modo `canonical`, o smoke SHALL conferir também o WAF (`/api/qualquer-coisa` → 403) e o domínio
antigo do projeto (`teko-api*.vercel.app` → 308 para o canônico, com o caminho).

#### Scenario: WAF desligado

- **WHEN** `GET /api/qualquer-coisa` no domínio canônico responde 404 da API em vez do 403 do WAF
- **THEN** a checagem `waf-unknown-api` falha

### Requirement: Retry só no sha logo depois do promote

No modo `canonical`, o smoke SHALL repetir só o `/healthz`, e só enquanto ele responder 200 com
outro `gitSha`, até 6 vezes com 5 s de intervalo; nenhuma outra checagem repete, e no modo
`deployment` nada repete.

#### Scenario: Deployment anterior por um instante

- **WHEN** as duas primeiras leituras do `/healthz` canônico trazem o sha anterior e a terceira traz o esperado
- **THEN** a checagem passa com 3 tentativas e as demais rodam uma vez cada

### Requirement: Workflow do smoke canônico sem segredo

`.github/workflows/smoke.yml` MUST rodar `scripts/smoke.ts --mode canonical` contra o `WEB_ORIGIN`
do ambiente por `workflow_call` e `workflow_dispatch` (inputs `environment` e `expected-sha`), sem
environment do GitHub e sem segredo, com harden-runner em `block` liberando só os domínios
canônicos e antigos dos dois projetos além do GitHub e do Node. Sem `expected-sha`, SHALL usar o
`gitSha` que o `/healthz` do ambiente responde.

#### Scenario: Smoke de produção à mão

- **WHEN** o mantenedor dispara o `smoke.yml` com `environment: production`
- **THEN** o job roda sem pedir a aprovação do environment `production` e publica o relatório como artifact

### Requirement: Roteiro do system test do staging

O system test (`apps/web/playwright.system.config.ts`, fora da suíte e2e) SHALL fazer 1 pergunta do
pool versionado de 30, escolhida pelo número do run, num período coberto pela família dela, com o
stream até o `finish`; repetir a mesma pergunta e receber a resposta do cache; pedir uma data fora
da cobertura e receber a recusa `out_of_coverage`; e trocar o idioma mantendo a página. O roteiro
MUST gerar no máximo 2 respostas de LLM por run e não ter retry.

#### Scenario: Cache quebrado

- **WHEN** a repetição da primeira pergunta não volta com `meta.cached: true`
- **THEN** o system test reprova (a repetição foi a segunda e última geração do run)

### Requirement: Login do system test por passkey

O system test MUST entrar no staging com o usuário persistente de teste por passkey, importando num
autenticador virtual do Chromium a credencial do segredo `SYSTEM_TEST_PASSKEY` do environment
`staging`, com um contador de assinaturas maior que o de qualquer run anterior.

#### Scenario: Run seguinte com o mesmo segredo

- **WHEN** dois runs importam a mesma credencial exportada
- **THEN** os dois entram, porque o contador importado cresce com o tempo

### Requirement: Workflow do system test só no tronco

`.github/workflows/system-test.yml` MUST rodar só em `refs/heads/main`, no environment `staging`,
por `workflow_call` (input `expected-sha`) e `workflow_dispatch`, e o único segredo que lê SHALL ser
`SYSTEM_TEST_PASSKEY`. Sem o segredo, o job MUST avisar (`::warning`) e terminar verde sem rodar o
Playwright; com `expected-sha`, MUST falhar se o `/healthz` do staging servir outro sha.

#### Scenario: Passkey ainda não registrada

- **WHEN** o system test roda antes de o mantenedor gravar `SYSTEM_TEST_PASSKEY`
- **THEN** o job termina verde com um aviso que aponta o runbook

### Requirement: Registro da passkey pelo mantenedor

`apps/web/system/register-passkey.ts` MUST ler o e-mail e a senha da conta de teste só do terminal
(a senha sem eco), recusar argumentos, cadastrar a passkey pela tela real das configurações do
staging num autenticador virtual, conferir a entrada só com a credencial exportada num navegador novo
e escrever no stdout apenas o JSON da credencial (`version`, `rpId`, `credentialId`, `privateKey`,
`userHandle`, `signCount`), para o `gh secret set SYSTEM_TEST_PASSKEY --env staging`.

#### Scenario: Stdin que não é terminal

- **WHEN** o script roda sem um TTY no stdin
- **THEN** ele sai com 1 sem abrir o navegador nem escrever no stdout
