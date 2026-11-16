# web-build Specification

## Purpose

Define o build do web como export estático puro, com a CSP de cada documento gerada no build, os
mesmos headers e rotas de plataforma na Vercel, no Plano B e na stack de CI, e o orçamento de bundle
total.

## Requirements

### Requirement: Build do web só estático

O `pnpm --filter @teko/web build` MUST falhar se o código do `apps/web` tiver route handler
(`route.ts` em `app/`), `'use server'`, `dynamic = 'force-dynamic'`, middleware/`proxy.ts` ou rota
de API do Pages Router, ou se o build gerar middleware, functions ou Server Actions nos manifestos do
`.next`, terminar o export sem sucesso ou deixar no `out/` um arquivo de tipo não estático.

#### Scenario: Route handler no app

- **WHEN** existe `src/app/api/hello/route.ts`
- **THEN** o pós-build falha apontando o arquivo como route handler

#### Scenario: Build limpo

- **WHEN** o build do web atual termina
- **THEN** nenhum guard aponta violação e o `out/` tem só HTML, payloads RSC, JS, CSS e fontes

### Requirement: CSP por documento gerada no build

O pós-build MUST gravar `out/.teko-headers.json` com a CSP de cada HTML do export (a de
`docs/architecture/frontend.md`), que SHALL trazer em `script-src` e `style-src-elem` o sha256 de
cada `<script>` executável e de cada `<style>` inline do documento, sem `'strict-dynamic'`, e o
Trusted Types em `Content-Security-Policy-Report-Only`. O build MUST falhar se a CSP de um
documento passar de 6 KB.

#### Scenario: Diretivas da CSP

- **WHEN** o pós-build gera a CSP de um documento com um script inline
- **THEN** ela começa com `default-src 'self'; script-src 'self' 'sha256-…'` e termina com
  `frame-ancestors 'none'; upgrade-insecure-requests`, com `connect-src 'self'
  https://eu.i.posthog.com`, e o report-only é `require-trusted-types-for 'script'`

#### Scenario: Script de tema

- **WHEN** a página `/en/` é aberta com `localStorage['teko-theme'] = 'dark'`
- **THEN** o script inline de tema roda (`data-theme="dark"`) e nenhuma violação de CSP aplicada é
  registrada

#### Scenario: CSP grande demais

- **WHEN** um documento tem scripts inline cujos hashes somam mais de 6 KB de CSP
- **THEN** o pós-build falha e aponta o documento

### Requirement: Headers do estático iguais em todo host

A Vercel, o Plano B e o Caddy da stack de CI MUST servir o export com HSTS, `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
restritiva e COOP/CORP `same-origin`, e cada HTML com os headers do seu documento no manifesto,
inclusive as páginas de 404. O manifesto SHALL NOT ser servido.

#### Scenario: Página com CSP

- **WHEN** o navegador pede `/pt-BR/`
- **THEN** a resposta traz a CSP de `pt-BR/index.html` e os headers de segurança comuns

#### Scenario: Manifesto escondido

- **WHEN** alguém pede `/.teko-headers.json`
- **THEN** a resposta é o 404 da raiz

### Requirement: Rotas de plataforma

`/` MUST redirecionar (302, `Cache-Control: private, no-store`, `Vary: Accept-Language`) para
`/en/` quando o primeiro idioma do `Accept-Language` é inglês e para `/pt-BR/` nos demais casos. Um
caminho inexistente dentro de um locale MUST responder 404 com a página de 404 daquele locale, e
fora dos locales, com o `404.html`. `/_next/static/*` MUST ter
`Cache-Control: public, max-age=31536000, immutable`.

#### Scenario: 404 em inglês

- **WHEN** o navegador pede `/en/xyz`
- **THEN** recebe 404 em `/en/xyz/` com a página de 404 em inglês (`lang="en"`)

#### Scenario: Raiz em inglês

- **WHEN** `/` é pedido com `Accept-Language: en-US,en;q=0.9`
- **THEN** a resposta é 302 para `/en/`

### Requirement: Orçamento de bundle total

O pós-build MUST somar o gzip da união dos chunks JS que os HTML do export carregam no primeiro
acesso (sem o polyfill `nomodule` e sem `import()` sob demanda) e falhar se a soma passar de
`firstLoadJsGzipKiB` em `apps/web/bundle-budget.json`.

#### Scenario: Acima do orçamento

- **WHEN** o JS do primeiro acesso soma mais que o limite versionado
- **THEN** o build falha citando o total, o limite e os maiores chunks

### Requirement: Raiz por idioma em desenvolvimento

Em `next dev`, o `next.config.ts` MUST redirecionar `/` com a mesma regra das rotas de produção:
`/en/` quando o primeiro idioma do `Accept-Language` é inglês e `/pt-BR/` nos demais casos. Um teste
SHALL conferir que a expressão do web é a do `policy.ts` da API.

#### Scenario: Raiz em desenvolvimento

- **WHEN** `next dev` recebe `/` com `Accept-Language: en-US,en;q=0.9`
- **THEN** responde um redirect temporário para `/en/`

### Requirement: Entrada estática sem escolha de idioma

A página estática de `/` SHALL NOT mostrar escolha de idioma: é uma tela neutra com a logo que vai
na hora para o idioma do navegador, pela mesma regra do `Accept-Language`. O redirect para o locale
padrão e os links dos dois idiomas MUST ficar só no `<noscript>`.

#### Scenario: Entrada estática em outro servidor

- **WHEN** um servidor estático sem as rotas de produção serve `/index.html` a um navegador em inglês
- **THEN** o navegador vai para `/en/` sem mostrar texto de escolha de idioma

#### Scenario: Entrada sem JavaScript

- **WHEN** a entrada `/` abre com o JavaScript desligado
- **THEN** o `<meta refresh>` leva a `/pt-BR/`, e os links dos dois idiomas aparecem
