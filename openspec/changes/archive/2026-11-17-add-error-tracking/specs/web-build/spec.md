## MODIFIED Requirements

### Requirement: CSP por documento gerada no build

O pós-build MUST gravar `out/.teko-headers.json` com a CSP de cada HTML do export (a de
`docs/architecture/frontend.md`), que SHALL trazer em `script-src` e `style-src-elem` o sha256 de
cada `<script>` executável e de cada `<style>` inline do documento, sem `'strict-dynamic'`, e o
Trusted Types em `Content-Security-Policy-Report-Only`. Com `NEXT_PUBLIC_POSTHOG_ERRORS_KEY` no
build, as duas políticas MUST terminar em `report-uri https://eu.i.posthog.com/report/?token=<chave>;
report-to posthog`, e o documento SHALL ganhar `Reporting-Endpoints: posthog="<o mesmo endpoint>"`;
sem a chave, nenhuma diretiva de relatório entra. Uma chave fora do formato `phc_…` MUST derrubar o
build. O build MUST falhar se a CSP de um documento passar de 6 KB.

#### Scenario: Diretivas da CSP

- **WHEN** o pós-build gera, sem a chave dos erros, a CSP de um documento com um script inline
- **THEN** ela começa com `default-src 'self'; script-src 'self' 'sha256-…'` e termina com
  `frame-ancestors 'none'; upgrade-insecure-requests`, com `connect-src 'self'
  https://eu.i.posthog.com https://eu-assets.i.posthog.com`, e o report-only é
  `require-trusted-types-for 'script'`

#### Scenario: Relatórios ao PostHog

- **WHEN** o build tem `NEXT_PUBLIC_POSTHOG_ERRORS_KEY=phc_x`
- **THEN** a CSP e o report-only terminam em
  `report-uri https://eu.i.posthog.com/report/?token=phc_x; report-to posthog`, e o documento traz
  `Reporting-Endpoints: posthog="https://eu.i.posthog.com/report/?token=phc_x"`

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
inclusive as páginas de 404. O manifesto e os source maps (`*.map`) SHALL NOT ser servidos.

#### Scenario: Página com CSP

- **WHEN** o navegador pede `/pt-BR/`
- **THEN** a resposta traz a CSP de `pt-BR/index.html` e os headers de segurança comuns

#### Scenario: Manifesto escondido

- **WHEN** alguém pede `/.teko-headers.json`
- **THEN** a resposta é o 404 da raiz

#### Scenario: Source map escondido

- **WHEN** alguém pede o `.map` de um chunk de `/_next/static/chunks/`
- **THEN** a resposta é 404 (o `.vercel/output/static` nem tem o arquivo), embora o `out/` o guarde
  para o upload ao PostHog
