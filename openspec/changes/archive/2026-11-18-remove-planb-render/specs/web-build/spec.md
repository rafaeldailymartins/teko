## MODIFIED Requirements

### Requirement: Headers do estático iguais em todo host

A Vercel e o Caddy da stack de CI MUST servir o export com HSTS, `nosniff`,
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

### Requirement: Raiz por idioma em desenvolvimento

Em `next dev`, o `next.config.ts` MUST redirecionar `/` com a mesma regra das rotas de produção:
`/en/` quando o primeiro idioma do `Accept-Language` é inglês e `/pt-BR/` nos demais casos. Um teste
SHALL conferir que a expressão do web é a de `scripts/lib/static-site-policy.ts`.

#### Scenario: Raiz em desenvolvimento

- **WHEN** `next dev` recebe `/` com `Accept-Language: en-US,en;q=0.9`
- **THEN** responde um redirect temporário para `/en/`
