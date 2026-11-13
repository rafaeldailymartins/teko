---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0029 — Web e API na mesma origem, num projeto Vercel só

## Contexto e problema

Até a F3, o export estático do Next ficava no site `tekoia` da Netlify, e a API, na Function da
Vercel ([ADR 0004](0004-vercel-hobby-api.md)). As chamadas curtas passavam por um proxy assinado
da Netlify (`/api/*` com `x-nf-sign`, plugin `context-routing`), e o stream da pergunta ia direto
do navegador à Vercel, com ticket HMAC, CORS e uma origem própria (`NEXT_PUBLIC_STREAM_ORIGIN`).
Os spikes F1 (a) e (c) ([ADR 0003](0003-f1-spikes.md)) provaram que isso funciona, mas o desenho
cobra caro de um mantenedor solo:

- duas plataformas, dois conjuntos de cotas (os 300 créditos da Netlify pausam o site inteiro),
  um CLI isolado a mais (`tools/netlify-cli`, 835 pacotes com exceções de proveniência e licença)
  e um plugin do Next declarado só para se desligar;
- um segredo compartilhado (`NETLIFY_PROXY_JWS_SECRET`) que, no plano Free da Netlify, é variável
  comum, legível no painel e presente no ambiente do build;
- o corte de 26 s do proxy, o IP do cliente só confiável com assinatura, uma regra de WAF só para
  o pré-filtro do `x-nf-sign` e o `/pt-BR/` que a Netlify troca por `/pt-br/`;
- para o stream: ticket de uso único, reemissão, `STREAM_ORIGIN`, CORS com preflight e CSP
  `connect-src` apontando para outra origem.

Na revisão de arquitetura de 2026-11-12, o mantenedor aprovou servir a web e a API na mesma origem.

## Decisão

1. **Um projeto Vercel por ambiente serve tudo.** Os projetos foram renomeados para `tekoia`
   (produção) e `tekoia-staging`, com os domínios canônicos `tekoia.vercel.app` e
   `tekoia-staging.vercel.app`. O `scripts/build-vercel-output.ts` monta um `.vercel/output`
   (Build Output API v3, [ADR 0017](0017-vercel-build-output-tsdown.md)) com o `apps/web/out` em
   `static/` e a mesma Function `index`. Só `/api/*` e `/healthz` chegam à Function; o resto é
   servido pela CDN, sem invocação.
2. **Rotas escritas à mão no `config.json`**, sem o `@vercel/routing-utils` (sem proveniência,
   [ADR 0002](0002-supply-chain-pnpm.md)), e fixadas pelo `scripts/build-vercel-output.test.ts`,
   que simula o roteamento e confere o export real:
   - `teko-api.vercel.app` e `teko-api-staging.vercel.app` (os domínios antigos, que continuam nos
     projetos) respondem 308 para o canônico do mesmo projeto (`has: host`), inclusive na API: o
     cookie de sessão e o `rpID` das passkeys dependem de um host único;
   - `/api/*` e `/healthz` → Function `index`, antes do filesystem e sem os headers do estático;
   - headers de segurança em todo o estático (HSTS, `nosniff`, `X-Frame-Options`, COOP/CORP,
     `Permissions-Policy` e um CSP parcial que não depende do HTML) e `/_next/static/*` imutável;
   - `/` → `/en/` (primeiro idioma do `Accept-Language` em inglês) ou `/pt-BR/`, 302 com
     `Cache-Control: private, no-store` e `Vary: Accept-Language`, como o `_redirects` fazia;
   - `/pt-br/...` → `/pt-BR/...` (308), `trailingSlash` (308 para a barra final) e, depois do
     filesystem, 404 com a página do locale ou o `404.html`.
3. **Sai a Netlify inteira:** o site `tekoia`, o `netlify.toml`, o plugin `context-routing`, o
   `_redirects`, o `@netlify/plugin-nextjs`, o `tools/netlify-cli`, o `NETLIFY_PROXY_JWS_SECRET`, o
   `NETLIFY_CLIENT_IP_TRUSTED`, os headers `x-nf-*`, a regra 2 do WAF e o corte de 26 s. O Netlify
   Blobs sai em duas etapas ([ADR 0030](0030-artefatos-no-github-releases.md)).
4. **Stream na mesma origem.** `POST /api/v1/questions/:id/stream` é autenticado pelo cookie de
   sessão e por uma checagem de `Origin` (igual a `WEB_ORIGIN`) nos métodos que mudam estado; saem
   o ticket HMAC, a reemissão (`POST /questions/:id/ticket`), o `TICKET_SIGNING_KEY`, o
   `STREAM_ORIGIN`/`NEXT_PUBLIC_STREAM_ORIGIN`, o CORS (`@fastify/cors`) e os códigos
   `ticket_invalid`/`ticket_reused`. O claim atômico `pending → streaming` continua garantindo um
   stream por pergunta; um segundo pedido é `stream_busy`. A resposta `accepted` de
   `POST /api/v1/questions` não traz mais `stream`. A F4 implementa a rota e a checagem de `Origin`.
5. **IP do cliente:** o `x-real-ip` que a borda da Vercel sobrescreve, em todas as rotas (sem
   caminho proxiado na porta `ClientIp`). O rate limit por IP do WAF e da aplicação passa a valer
   em qualquer rota. A geolocalização usa o `geolocation()` do `@vercel/functions` (já fixado em
   3.7.6) em vez do GeoIP DB-IP previsto no plano; nenhum código de GeoIP existia.
6. **WAF** (`infra/vercel/firewall-rules.json`, aplicado na F7; o Hobby tem 3 regras custom, só
   1 de rate limit): a regra 1 nega `/api/*` fora dos prefixos conhecidos (o estático passa); a
   regra 2, que exigia o `x-nf-sign`, vira "o estático só aceita GET e HEAD"; a regra 3 continua
   sendo o rate limit por IP do stream. O rate limit por IP das demais rotas fica na aplicação
   (`@fastify/rate-limit` com store em Postgres, F4), agora com o IP real em todas elas.
7. **`FUNCTION_MAX_DURATION_S` sem padrão.** O padrão de 300 s do `env.ts` divergia em silêncio do
   `maxDuration: 120` do `.vc-config.json`; agora a variável é obrigatória com
   `RUNTIME_TARGET=vercel`, e o teste do `build-vercel-output` confere o valor dos `env.*.json`.
8. **Web sem FSD.** O `apps/web/src` vira `app/` (rotas do Next), `components/` e `lib/`; o
   steiger sai do pacote (o script e o passo do CI saem com o pacote de CI enxuto, ADR 0032).
9. **Dev local:** o `next dev` (:3000) reescreve `/api/*` para a API (`pnpm dev`, :4000); o Caddy
   do proxy assinado de dev, o `DEV_PROXY_JWS_SECRET` e o `DEV_STATIC_JWS` saem.
10. **Plano B (Render):** o mesmo serviço serve o `out/` estático e a API, na mesma origem: com
    `WEB_STATIC_DIR` (proibida na Vercel), o Fastify registra o `@fastify/static` 10.1.10
    (proveniência SLSA, MIT) com a mesma política das rotas da Vercel
    (`apps/api/src/adapters/in/http/static-site/policy.ts`, que o `build-vercel-output` também
    importa). O `infra/planb-render/render.yaml` constrói o web e aponta `WEB_ORIGIN` para o
    próprio serviço.

## Consequências

- Bom: uma plataforma, um deploy atômico para web e API, um conjunto de cotas e nenhum segredo
  compartilhado entre provedores. A CDN da Vercel serve o estático sem invocar a Function nem
  consumir CPU.
- Bom: sem CORS, sem ticket e sem segunda origem, o stream é uma requisição comum autenticada pelo
  cookie; o CSP `connect-src` fica em `'self'` para a API.
- Bom: o IP do cliente é confiável em todas as rotas, e o rate limit por IP passa a proteger a API
  inteira.
- Ruim: o estático conta nas cotas de CDN do Hobby (requisições e Fast Data Transfer); o tráfego
  negado pelo WAF não conta. A guarda diária de uso (F7) passa a olhar também essas métricas.
- Ruim: um deploy da API republica o estático (e vice-versa). Os dois saem do mesmo commit no CI,
  então não há versão cruzada.
- Ruim: as rotas e os headers do estático ficam num `config.json` nosso, e o CSP completo com os
  hashes dos scripts inline (F5) passa a ser gerado como rotas por caminho em vez de `_headers`.
- Neutro: o tipo `tag:teko-api.vercel.app,2026:problems/<code>` do problem+json continua igual: é
  um identificador opaco, e o domínio continua do projeto.

## Confirmação

- `scripts/build-vercel-output.test.ts`: forma do `.vercel/output`, cada rota pelo simulador e o
  export real do web quando `apps/web/out` existe.
- `apps/api` (unitários e integração): sem CORS em nenhuma rota, IP da borda sem caminho
  proxiado, `FUNCTION_MAX_DURATION_S` obrigatória com `RUNTIME_TARGET=vercel`.
- F7: smoke do deploy no domínio canônico (estático, `/healthz`, 308 dos domínios antigos) e as
  regras do WAF conferidas pelo efeito.

## Mais informações

- Fontes Context7 consultadas em 2026-11-12: `/websites/vercel` (Build Output API v3:
  `config.json` com `routes`, `handle: filesystem`, `has` de `host` e `header` com
  `MatchableValue`, `continue`, `status` com `Location`, `caseSensitive`, diretório `static/`).
- Substitui em parte: [ADR 0002](0002-supply-chain-pnpm.md) (seção Netlify), [ADR
  0003](0003-f1-spikes.md) (spikes (a) e (c)), [ADR 0004](0004-vercel-hobby-api.md) (projetos,
  domínios e WAF) e [ADR 0017](0017-vercel-build-output-tsdown.md) (rotas do `config.json`).
- Ações manuais do mantenedor: `infra/vercel/README.md`, seção "Mesma origem (ADR 0029)".
