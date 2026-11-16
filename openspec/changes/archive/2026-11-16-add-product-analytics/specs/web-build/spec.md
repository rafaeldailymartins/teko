# Spec Delta

## MODIFIED Requirements

### Requirement: CSP por documento gerada no build

O pós-build MUST gravar `out/.teko-headers.json` com a CSP de cada HTML do export (a de
`docs/architecture/frontend.md`), que SHALL trazer em `script-src` e `style-src-elem` o sha256 de
cada `<script>` executável e de cada `<style>` inline do documento, sem `'strict-dynamic'`, e o
Trusted Types em `Content-Security-Policy-Report-Only`. O build MUST falhar se a CSP de um documento
passar de 6 KB.

#### Scenario: Diretivas da CSP

- **WHEN** o pós-build gera a CSP de um documento com um script inline
- **THEN** ela começa com `default-src 'self'; script-src 'self' 'sha256-…'` e termina com
  `frame-ancestors 'none'; upgrade-insecure-requests`, com `connect-src 'self'
  https://eu.i.posthog.com https://eu-assets.i.posthog.com`, e o report-only é
  `require-trusted-types-for 'script'`

#### Scenario: Script de tema

- **WHEN** a página `/en/` é aberta com `localStorage['teko-theme'] = 'dark'`
- **THEN** o script inline de tema roda (`data-theme="dark"`) e nenhuma violação de CSP aplicada é
  registrada

#### Scenario: CSP grande demais

- **WHEN** um documento tem scripts inline cujos hashes somam mais de 6 KB de CSP
- **THEN** o pós-build falha e aponta o documento
