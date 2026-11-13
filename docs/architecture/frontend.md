# Frontend (`apps/web`)

Export estático do Next.js servido pela CDN da Vercel, no mesmo projeto e na mesma origem da API
(ADR 0029). Nenhuma lógica de negócio: toda verificação real fica no Fastify.

## Runtime: export estático puro

- Next.js 16, React 19 com React Compiler, `output: 'export'`, `trailingSlash: true`,
  `images.unoptimized: true`, `typedRoutes`, `transpilePackages: ['@teko/shared']`.
- O `apps/web/out` é copiado para `.vercel/output/static` pelo `scripts/build-vercel-output.ts`;
  não há adapter de plataforma nem functions do Next.
- **Ficam de fora:** `proxy.ts`/middleware, route handlers, Server Actions, `next/image` otimizado e
  rotas dinâmicas (viram query params via nuqs: `/pt-BR/chat/?q=<questionId>&c=<conversationId>&ref=2024-03`).
- **Guards de CI:** falha se existir `app/**/route.ts(x)`, `'use server'` ou
  `dynamic = 'force-dynamic'`, ou se o build gerar algo fora do estático.
- **Rotas de plataforma** (no `config.json` do Build Output, não no Next): `/` redireciona para
  `/pt-BR/` ou `/en/` por `Accept-Language`; 404 por locale (`app/[locale]/[...rest]/page.tsx` com
  `generateStaticParams → {rest:['404']}`); `/_next/static/*` com
  `Cache-Control: public, max-age=31536000, immutable`. Um e2e acessa `/en/xyz`.
- **Dev local:** `pnpm dev` sobe web (`:3000`) e API (`:4000`); em desenvolvimento, `rewrites()` do
  Next manda `/api/*` para a API, e o navegador vê uma origem só. Não há proxy assinado nem segredo
  de dev para o caminho web → API. O login local usa `pnpm --filter @teko/api seed:dev-session`.

## Estrutura

Sem Feature-Sliced Design (o steiger saiu, ADR 0032):

```text
apps/web/
  src/app/                     # rotas do App Router (só reexportam) e globals.css
  src/app/[locale]/{layout,page,not-found}.tsx
  src/app/[locale]/{chat,provision,compare,history,settings,sign-in,coverage,about,privacy,terms,[...rest]}/page.tsx
  src/components/              # ui/ (shadcn), páginas e componentes de tela
  src/lib/                     # site, i18n/, theme, contrast; depois api/, validity/, analytics/
  messages/{en,pt-BR}.json
```

As rotas ficam em `src/app` (o Next aceita o App Router dentro de `src/`) e só reexportam de
`src/components`; não há mais `app/` nem `pages/` na raiz de `apps/web`.

O Biome restringe `fetch(` a `src/lib/api`. A fronteira com a API é o contrato de `@teko/shared` e o
cliente gerado.

## Design system

- Tailwind 4 CSS-first, `tw-animate-css`; shadcn sobre Base UI (`init -b base`), aliases em
  `@/components/ui`. Componentes: message-scroller, message, bubble, code-block, command, resizable,
  drawer, calendar, popover, hover-card, sheet, tabs, table, skeleton, sonner, dialog, mais padrões
  de AI Elements (inline-citation, sources, suggestion, prompt-input).
- Cores em OKLCH: primária petróleo `oklch(0.50 0.09 205)`, acento âmbar para data e vigência,
  tokens de domínio `--validity-current`, `--validity-superseded`, `--validity-future`,
  `--coverage-out` e `--degraded`. Um teste com `culori` exige contraste ≥ 4,5:1 em texto e ≥ 3:1 em
  UI e foco, nos dois temas.
- Tema in-house (script inline com hash na CSP, `localStorage['teko-theme']`, `color-scheme`).
- Tipografia self-hosted: Geist Sans (UI), Geist Mono (registros e campos, `tabular-nums`), Source
  Serif 4 (texto legal e headlines). Base 14 px; respostas 15 px/1,6; `data-density`.
- Motion com `LazyMotion domAnimation strict` e `reducedMotion="user"`; `<ViewTransition>` nas rotas.

## Dados e streaming

- Cliente gerado do OpenAPI (`@hey-api/openapi-ts`, `client-fetch` com `baseUrl: '/api'`, SDK e
  TanStack Query). O CI faz `git diff --exit-code` no código gerado.
- TanStack Query (`staleTime: 60_000`, keys com `referenceDate` quando a resposta depende dela),
  Form (schemas de `@teko/shared`), Table, Virtual, Pacer e Hotkeys (os dois últimos atrás de
  adapters em `src/lib`).
- **Chat:** `useChat<TekoUIMessage>` com transporte próprio em `src/lib/api/chat-transport.ts`:

```ts
export class TekoChatTransport implements ChatTransport<TekoUIMessage> {
  async sendMessages({ chatId, messages, abortSignal }) {
    const r = await askQuestion({
      conversationId: chatId,
      question: lastText(messages),
      ...referenceState(),
    })
    if (r.status !== 'accepted') return synthesizeChunks(r) // answered | refused | needs_clarification
    const res = await fetch(`/api/v1/questions/${r.questionId}/stream`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: abortSignal,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    return parseJsonEventStream({ stream: res.body!, schema: uiMessageChunkSchema }).pipeThrough(
      unwrapParsed(),
    )
  }
  async reconnectToStream() {
    return null
  } // sem resume: relê GET /questions/:id
}
```

Os schemas dos data parts ficam em `@teko/shared/contracts`. Sem ticket, sem segunda origem e sem
CORS: o stream leva o cookie de sessão, e a API confere o `Origin`.
- **Markdown:** Streamdown + `@streamdown/code`, sem mermaid nem math; `rehype-harden` com
  `allowedLinkPrefixes` (a própria origem, `sped.rfb.gov.br`, `www.gov.br`,
  `appasp.economia.go.gov.br`), sem imagens e sem `data:`. O link `cite:<id>` vira `CitationChip`.

## Segurança no navegador

Um passo de pós-build (htmlparser2) percorre `out/**/*.html`, calcula o sha256 dos `<script>` e
`<style>` inline e gera os headers por caminho, que vão para o `config.json` do Build Output
(falha se o CSP passar de 6 KB):

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-…'; style-src-elem 'self' 'sha256-…';
  style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self';
  connect-src 'self' https://eu.i.posthog.com; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; upgrade-insecure-requests; report-to <endpoint de relatório de CSP>
```

- Sem `'strict-dynamic'` (anularia o `'self'` dos scripts do Next); `style-src-attr 'unsafe-inline'`
  é concessão consciente (Motion e painéis redimensionáveis).
- PostHog com `disable_external_dependency_loading: true` e surveys no bundle.
- HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  restritiva, COOP/CORP `same-origin`.
- **Trusted Types** em report-only (`require-trusted-types-for 'script'`); enforce depois da v0.1.0,
  após 14 dias sem violação no staging.
- O destino dos relatórios de CSP e de erro é o PostHog Error Tracking, se a F6 confirmar que ele
  cobre source maps e relatório de CSP; senão, Sentry (projeto separado para CSP).

## UX

- **App shell** em três painéis redimensionáveis (histórico, thread, citação), operáveis por teclado;
  abaixo de 768 px, a citação vira Drawer.
- **Data de referência:** chip fixo no composer ("Período de apuração: 03/2024"), month picker com
  alternância para data exata, presets (mês anterior, mês atual, último período fechado); enquanto o
  usuário não mexe, envia `source:'default'`; inferida do texto fica âmbar ("confirmar");
  `needs_clarification` mostra botões. Todo cabeçalho de resposta repete a data e a vigência usadas.
- **Cobertura** no composer e `CoverageBanner` (fundamentada, parcial, fora de cobertura); o envio
  continua permitido, para a API recusar formalmente.
- **Rótulos de degradação:** "Somente busca lexical", "Modelo de reserva", "Resposta em cache".
- **Cota:** `quota_exceeded` e `service_paused` desabilitam o composer e mostram o reset.
- **Citações:** chips numerados durante o stream, hover card e painel com documento, versão, badge
  de intervalo, texto (`lang="pt-BR"`), tabela de campos, link para a fonte, "copiar citação",
  "reportar", linha do tempo e "O que mudou" (diff lazy).
- **Privacidade:** aviso de treino do provedor gratuito, 18+ e versão dos Termos no primeiro uso;
  detector de PII no composer; `region_restricted` vira página de aviso.
- **Teclado:** `Ctrl/⌘+K` paleta, `/` composer, `Ctrl/⌘+Enter` envia, `Esc` para ou fecha,
  `[`/`]` citações, `Alt+D` data.
- **Estados:** sugestões sensíveis à data (RCTE art. 76 § 6º em 05/2008 contra 01/2010 e 03/2004
  contra 05/2006), skeletons, bolha otimista, `ErrorBoundary` por bloco, disclaimer fixo "Apoio à
  consulta; não constitui parecer".
- **Landing** estática, sem chamada à API: hero com demo roteirizada, "Como funciona", corpus
  coberto, garantias, FAQ.

## i18n e acessibilidade

- next-intl com `localePrefix: 'always'`, `defaultLocale: 'pt-BR'`, `generateStaticParams` +
  `setRequestLocale`, `timeZone: 'America/Sao_Paulo'`. Testes de paridade de chaves en/pt-BR e de uma
  chave `errors.<code>` por `ErrorCode`. Na mesma origem da Vercel, `/pt-BR/` mantém a caixa.
- WCAG 2.2 AA: região `aria-live="polite"` anuncia início e fim da resposta, `aria-busy` no stream,
  foco no composer, skip link, critérios 2.4.11, 2.5.8, 2.5.7 e 3.3.8; trechos legais com
  `lang="pt-BR"` também na UI em inglês.

## Analytics e orçamentos

- **PostHog** (EU), direto: `cookieless_mode:'on_reject'`, `person_profiles:'identified_only'`,
  replay desligado, desligado no staging, surveys só com consentimento, banner LGPD com Aceitar,
  Recusar e Personalizar de mesmo peso. Eventos em [observabilidade](observabilidade.md).
- **Orçamento:** JS gz total do first-load (um orçamento de bundle total, checado no build). As
  metas de Web Vitals (LCP ≤ 2,0 s, INP ≤ 150 ms, CLS ≤ 0,05, primeiro token ≤ 1,5 s) são
  acompanhadas em produção pelo evento `web_vital`. Lighthouse CI e orçamentos por rota ficam para
  depois da v0.1.0.
