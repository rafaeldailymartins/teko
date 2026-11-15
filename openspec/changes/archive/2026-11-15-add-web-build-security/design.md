# Design

## Context

Desenho em `docs/architecture/frontend.md` (Runtime e Segurança no navegador) e ADR 0029: o export
do Next é servido pela CDN da Vercel, pelo Fastify no Plano B e pelo Caddy na stack de CI, e os três
precisam da mesma política. A CSP depende do HTML (hashes dos scripts inline do tema e do payload
RSC do Next), então só pode nascer depois do `next build`.

## Decisions

- **Pós-build no pacote do web.** `apps/web/scripts/postbuild.ts` roda no fim do `build`
  (`next build && node scripts/postbuild.ts`), entra no hash do turbo como qualquer arquivo do
  pacote e é testado pelo Vitest do `apps/web`. O CI repete o pós-build no job `build`, porque um
  cache hit do turbo restaura o `out/` sem executar o script. Alternativa: um script na raiz
  (`scripts/`), descartada porque o turbo não poria o script no hash do build do web, e o
  `htmlparser2` viraria dependência da raiz.
- **Guard em duas metades.** Código-fonte (rota `route.ts` em `app/`, `'use server'`,
  `force-dynamic`, middleware/`proxy.ts`, `pages/api`) e resultado do build (`export-detail.json`
  com sucesso; `middleware-manifest`, `functions-config-manifest` e `server-reference-manifest`
  vazios; nenhum route handler no `app-path-routes-manifest`; `out/` só com extensões estáticas). O
  `next build` gera `.next/server/app` mesmo no export (é o que ele usa para pré-renderizar), então
  a prova de "só estático" são os manifestos vazios, não a ausência do diretório.
- **Manifesto de headers por arquivo.** `out/.teko-headers.json` = `{ version: 1, documents: {
  "<arquivo>.html": { "Content-Security-Policy", "Content-Security-Policy-Report-Only" } } }`. A
  chave é o arquivo, não o caminho: cada consumidor sabe quais caminhos servem o arquivo (o 200 e as
  páginas de 404). O `policy.ts` (sem imports, já importado pelo `build-vercel-output` e pelo Plano
  B) valida o manifesto: caminho `.html` sem `..`, só os dois headers e valores sem controle, aspas
  nem crase. O nome começa com ponto: o `@fastify/static` ignora dotfiles, o Caddy o esconde e a
  Vercel não o copia para o `static/`.
- **Só documentos têm CSP.** Os headers comuns (HSTS, `nosniff`, `X-Frame-Options`, Referrer,
  Permissions, COOP, CORP) valem para todo o estático; a CSP e o Trusted Types report-only, só para
  HTML. Assim, na Vercel, nenhuma resposta recebe o mesmo header de duas rotas: a rota de um
  documento casa só o caminho exato que o serve (sensível à caixa) e as rotas de 404 trazem a CSP da
  página delas. O resultado não depende de como a Vercel combina headers repetidos, que a
  documentação não define; o simulador do teste falha se duas rotas definirem o mesmo header com
  valores diferentes.
- **Hash do texto cru.** O htmlparser2 roda com `decodeEntities: false` (o conteúdo de `<script>` e
  `<style>` é texto cru no HTML), e CRLF vira LF, como no pré-processamento do navegador. Entram os
  `<script>` executáveis (sem `type`, JS, `module`, `importmap`, `speculationrules`); blocos de dados
  como `application/ld+json` não passam pela CSP. O teste do `build-vercel-output` confere os hashes
  contra o `out/` real por um caminho independente (regex), e o e2e confere no navegador que o
  script de tema roda e que não há violação aplicada.
- **`upgrade-insecure-requests` também na stack de CI.** Medido em 2026-11-15 com o Chromium do
  Playwright contra o Caddy em `http://localhost`: os chunks carregam, sem upgrade para `https`.
- **`report-to` sem endpoint até a F6.** A F6 decide entre PostHog Error Tracking e Sentry; a
  diretiva e o `Reporting-Endpoints` entram com ela.
- **Caddy por snippets gerados.** O Caddy não lê JSON, então `scripts/caddy-static-site.ts` (raiz,
  sem dependências) gera `infra/ci/.static-site.caddy` a partir do `policy.ts` e do manifesto:
  `(teko_static)` e `(teko_not_found)`, importados pelo `Caddyfile`. O `up.sh` roda o gerador depois
  do build do web, e o compose monta o arquivo. Os matchers de documento no Caddy ignoram a caixa:
  lá o `header` substitui o valor, e a página de 404 troca a CSP pela dela. Alternativa: servir o
  estático pela API na stack de CI (o caminho do Plano B), descartada porque a stack imita a CDN da
  Vercel.
- **Orçamento de bundle total.** Soma do gzip (nível padrão do zlib) da união dos chunks que os HTML
  do export carregam no primeiro acesso: `<script src>` sem `nomodule` e
  `<link rel="preload" as="script">`/`modulepreload` de `/_next/static/`. Cada chunk conta uma vez;
  o polyfill `nomodule` e os `import()` sob demanda ficam de fora. A alternativa (todo
  `out/_next/static/**/*.js`) contaria os chunks lazy do chat, que não pesam no primeiro acesso.
  Medição em 2026-11-15 (landing da F4, 8 HTML): 132 KiB, dos quais 70 KiB do runtime do React e
  49 KiB do Next. Limite: 400 KiB em `apps/web/bundle-budget.json`, folga para o chat (AI SDK,
  Streamdown, TanStack Query, Motion) e o design system (Base UI) das próximas ondas; o coordenador
  ajusta no fim da F5.
- **Teto da CSP.** 6 KB por documento (cerca de 100 hashes); hoje a maior tem 518 bytes.

## Risks / Trade-offs

- Um HTML novo sem entrada no manifesto derrubaria a CSP daquele caminho; o `build-vercel-output`
  falha se algum HTML copiado não tiver CSP ou se o manifesto citar HTML inexistente, e o Plano B
  não sobe sem manifesto.
- Uma página com muitos scripts inline (payload RSC grande partido em vários `<script>`) pode
  encostar no teto de 6 KB; o pós-build falha e aponta o arquivo.
- O Caddy em Windows (bind mount sem distinção de caixa) serve `/EN/` como página; no Linux do CI é
  404. Não afeta o e2e.

## Fontes Context7

- `/websites/vercel` (Build Output API v3): `routes` com `headers`, `continue`, `caseSensitive`,
  `has` de header, `handle: filesystem`; sem regra documentada para headers repetidos entre rotas.
- `/websites/caddyserver_caddyfile` (Caddy 2.11): `handle_errors` com `rewrite` + `file_server`
  preservando o status, `file_server` (`hide`, URIs canônicas com barra final), `path_regexp`,
  `header_regexp`, `import` de snippets.
- `/fb55/htmlparser2` (12.0.0): `Parser` com `onopentag`/`ontext`/`onclosetag`, `decodeEntities`,
  conteúdo cru de `<script>` e `<style>`.
- `/microsoft/playwright`: `APIRequestContext.get` com `maxRedirects: 0` (devolve o 3xx sem
  seguir), `page.addInitScript` e headers da resposta.
- `/vercel/next.js` (16.4): recursos fora do `output: 'export'` (route handlers dinâmicos, proxy,
  Server Actions) e a checagem de Server Actions no export; hash sha256 de script inline.
