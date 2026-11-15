# Frontend (`apps/web`)

Export estático do Next.js servido pela CDN da Vercel, no mesmo projeto e na mesma origem da API
(ADR 0029). Nenhuma lógica de negócio: toda verificação real fica no Fastify.

## Runtime: export estático puro

- Next.js 16, React 19 com React Compiler, `output: 'export'`, `trailingSlash: true`,
  `images.unoptimized: true`, `typedRoutes`, `transpilePackages: ['@teko/shared']`.
- O `apps/web/out` é copiado para `.vercel/output/static` pelo `scripts/build-vercel-output.ts`;
  não há adapter de plataforma nem functions do Next.
- **Ficam de fora:** `proxy.ts`/middleware, route handlers, Server Actions, `next/image` otimizado e
  rotas dinâmicas (viram query params via nuqs: `/pt-BR/chat/?q=<questionId>&c=<conversationId>&ref=2024-03`,
  `/pt-BR/provision/?k=<stableKey>&ref=2008-05` e `/pt-BR/compare/?k=<stableKey>&from=2008-05&to=2010-01`).
- **Pós-build** (`apps/web/scripts/postbuild.ts`, parte do `pnpm --filter @teko/web build` e
  repetido no job `build` do CI depois de um cache hit do turbo): falha se o código tiver
  `src/app/**/route.ts(x)`, `'use server'`, `dynamic = 'force-dynamic'`, middleware/`proxy.ts` ou
  rota de API do Pages Router, ou se o build gerar algo fora do estático (middleware, functions ou
  Server Actions nos manifestos do `.next`, export sem sucesso, arquivo de tipo não estático no
  `out/`). A metade do código-fonte também roda no `test:unit`. Depois grava o manifesto de
  headers (abaixo) e confere o orçamento de bundle.
- **Rotas de plataforma** (no `config.json` do Build Output, não no Next): `/` redireciona para
  `/pt-BR/` ou `/en/` por `Accept-Language`; 404 por locale (`app/[locale]/[...rest]/page.tsx` com
  `generateStaticParams → {rest:['404']}`); `/_next/static/*` com
  `Cache-Control: public, max-age=31536000, immutable`. A mesma semântica vale no Plano B
  (`static-site.ts`) e no Caddy da stack de CI (snippets de `scripts/caddy-static-site.ts`); o
  `apps/web/e2e/platform.spec.ts` acessa `/en/xyz` e confere headers e CSP.
- **Dev local:** `pnpm dev` sobe web (`:3000`) e API (`:4000`); em desenvolvimento, `rewrites()` do
  Next manda `/api/*` para a API, e o navegador vê uma origem só. Não há proxy assinado nem segredo
  de dev para o caminho web → API. O login local usa `pnpm --filter @teko/api seed:dev-session`.

## Estrutura

Sem Feature-Sliced Design (o steiger saiu, ADR 0032):

```text
apps/web/
  src/app/                     # rotas do App Router (só reexportam) e globals.css
  src/app/[locale]/{layout,page,not-found}.tsx
  src/app/[locale]/(app)/layout.tsx                  # app shell (cabeçalho, paleta, aviso fixo)
  src/app/[locale]/(app)/{chat,provision,compare,history,settings}/page.tsx
  src/app/[locale]/{sign-in,coverage,about,privacy,terms,[...rest]}/page.tsx
  src/components/              # ui/ (shadcn), app-shell/, pages/, providers.tsx e componentes de tela
  src/lib/                     # site, i18n/, theme, contrast, utils, navigation, hotkeys; depois api/, validity/, analytics/
  messages/{en,pt-BR}.json
```

As rotas ficam em `src/app` (o Next aceita o App Router dentro de `src/`) e só reexportam de
`src/components`; não há mais `app/` nem `pages/` na raiz de `apps/web`. O grupo `(app)` não muda as
URLs: ele dá às páginas do app um layout comum, que fica montado na navegação entre elas. As páginas
públicas usam o cabeçalho e o rodapé do site, como a landing. Os providers de cliente ficam em
`src/components/providers.tsx`, montado no layout de locale dentro do `NextIntlClientProvider`.

O Biome restringe `fetch(` a `src/lib/api` (`noRestrictedGlobals` no `apps/web/biome.json`, com
override para `src/lib/api/**` e teste em `test/biome-boundary.test.ts`). A fronteira com a API é o
contrato de `@teko/shared` e o cliente gerado.

## Design system

- Tailwind 4 CSS-first, `tw-animate-css`; shadcn sobre Base UI, com os componentes copiados do
  registry `base-nova` para `@/components/ui` (sem o CLI do shadcn no lockfile) e `cn` em
  `src/lib/utils.ts`. Cada componente entra com a mudança que o usa (o knip reprova arquivo e export
  mortos); o destaque de menus e da paleta usa `--muted`, não o âmbar. Componentes: message-scroller, message, bubble, code-block, command, resizable,
  drawer, calendar, popover, hover-card, sheet, tabs, table, skeleton, sonner, dialog, mais padrões
  de AI Elements (inline-citation, sources, suggestion, prompt-input).
- Cores em OKLCH: primária petróleo `oklch(0.50 0.09 205)`, acento âmbar para data e vigência,
  tokens de domínio `--validity-current`, `--validity-superseded`, `--validity-future`,
  `--coverage-out` e `--degraded`, mais os do shadcn (`--muted`, `--popover`, `--input`,
  `--secondary`, `--destructive`). Um teste (`src/lib/contrast.ts`, sem dependência) exige contraste
  ≥ 4,5:1 em texto e ≥ 3:1 em UI e foco, nos dois temas.
- Tema in-house (script inline com hash na CSP, `localStorage['teko-theme']`, `color-scheme`), com
  seletor no cabeçalho (claro, escuro, igual ao sistema) e na paleta.
- O Base UI não injeta `<style>` em runtime (`CSPProvider disableStyleElements`); a regra da scroll
  area fica em `globals.css`.
- Tipografia self-hosted pelo `next/font/google` (arquivos baixados no build e servidos da própria
  origem; os pacotes npm das fontes são OFL-1.1, fora da allowlist de licenças): Geist Sans (UI),
  Geist Mono (registros e campos, `tabular-nums`), Source Serif 4 (texto legal e headlines). Base 14 px; respostas 15 px/1,6; `data-density`.
- Motion com `LazyMotion domAnimation strict` e `reducedMotion="user"`, só quando alguma tela animar
  de fato (o shell usa só as transições CSS dos popups); `<ViewTransition>` nas rotas.

## Dados e streaming

- Cliente gerado do OpenAPI (`@hey-api/openapi-ts`, `client-fetch` com `baseUrl: '/api'`, SDK e
  TanStack Query) em `src/lib/api/__generated__/`. A fonte é `apps/web/openapi.json`, exportado pela
  CLI da API (`pnpm --filter @teko/api openapi:export`, sem servidor nem banco): caminhos relativos a
  `servers: [{ url: '/api' }]`, versão fixa e ordem estável. `pnpm --filter @teko/web api:generate`
  regenera os dois; o `pnpm api:check` (no `verify` e no job `lint` do CI) falha se algum deles
  difere do git. Os imports do gerado levam `.ts` (`output.module.extension`): o `.js` herdado do
  `nodenext` não resolve no Turbopack.
- Erros: um interceptor do cliente converte Problem Details em `ApiError` (`code: ErrorCode`,
  `retryable`, `traceId`, cota), e a UI mostra `t(error.messageKey)` (`errors.<code>`).
- TanStack Query (`staleTime: 60_000`, retry só de erro transitório; keys com a data efetiva de
  referência quando a resposta depende dela), options em `src/lib/api/queries.ts` e hooks em
  `src/lib/api/hooks.ts`; provider em `src/components/providers.tsx`, com o adapter do nuqs (parsers
  de `q`, `c` e `ref` do chat, `k` e `ref` do dispositivo e `k`, `from` e `to` da comparação em
  `src/lib/url-state.ts`, com os links montados pelo `createSerializer`). A lista de conversas é
  infinita por cursor (`conversationsQuery`, `initialPageParam: {}`); componentes com
  `useQueryStates` trazem o próprio `<Suspense>`. Form (schemas de `@teko/shared`), Table, Virtual,
  Pacer e Hotkeys (os dois últimos atrás de adapters em `src/lib`).
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

Os schemas dos data parts ficam em `@teko/shared/contracts`; o `data-clarification` (candidatas do
`needs_clarification`) é só do cliente, em `src/lib/chat/parts.ts`, e a escolha volta por
`sendMessage(..., { body: { clarifiedDate } })` com `source: 'clarified'`. A mensagem do assistente
tem o id da pergunta (feedback, "reportar", releitura). Sem ticket, sem segunda origem e sem CORS: o
stream leva o cookie de sessão, e a API confere o `Origin`.
- **Markdown:** Streamdown + `@streamdown/code` (Shiki com o motor de regex em JavaScript: sem WASM
  nem `eval`), sem mermaid nem math e sem `rehype-raw` (HTML cru sai como texto); `rehype-harden`
  com `allowedLinkPrefixes` (a própria origem, `sped.rfb.gov.br`, `www.gov.br`,
  `appasp.economia.go.gov.br`), sem imagens e sem `data:`, e o componente de link confere o prefixo
  de novo. O link `cite:<id>` vira `#cite-<id>` antes do parse e depois `CitationChip`.
- **Carregamento:** a conversa (AI SDK, `useChat`), o painel de citação e o markdown (Streamdown,
  Shiki) são `lazy(() => import(...))` dentro de um `ClientOnly`, fora do primeiro carregamento; o
  HTML estático do `/chat/` leva o esqueleto da conversa.

## Segurança no navegador

O pós-build (htmlparser2) percorre `out/**/*.html`, calcula o sha256 dos `<script>` e `<style>`
inline e grava `out/.teko-headers.json`, o manifesto com a CSP e o Trusted Types report-only de
cada documento (falha se uma CSP passar de 6 KB):

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-…'; style-src-elem 'self' 'sha256-…';
  style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self';
  connect-src 'self' https://eu.i.posthog.com; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; upgrade-insecure-requests
```

- Os três lugares que servem o export consomem o mesmo manifesto, validado por
  `parseHeadersManifest` (`apps/api/src/adapters/in/http/static-site/policy.ts`, que também guarda
  os headers comuns): o `build-vercel-output` vira cada documento numa rota do `config.json` (o
  caminho exato que o serve, sensível à caixa, e as rotas de 404 com a CSP da página delas), o
  Plano B aplica pelo caminho e o Caddy da stack de CI importa os snippets gerados. O manifesto
  nunca é servido. Nenhuma rota da Vercel define o mesmo header que outra para a mesma resposta.
- Só os documentos têm CSP; JS, CSS, fontes e payloads RSC recebem os demais headers.
- Sem `'strict-dynamic'` (anularia o `'self'` dos scripts do Next); `style-src-attr 'unsafe-inline'`
  é concessão consciente (Motion e painéis redimensionáveis).
- **`report-to` fica de fora até a F6**, que escolhe o destino dos relatórios (abaixo); até lá as
  violações só aparecem no console.
- PostHog com `disable_external_dependency_loading: true` e surveys no bundle.
- HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  restritiva, COOP/CORP `same-origin`.
- **Trusted Types** em report-only (`require-trusted-types-for 'script'`); enforce depois da v0.1.0,
  após 14 dias sem violação no staging.
- O destino dos relatórios de CSP e de erro é o PostHog Error Tracking, se a F6 confirmar que ele
  cobre source maps e relatório de CSP; senão, Sentry (projeto separado para CSP).

## UX

- **App shell** com cabeçalho (navegação, paleta, idioma e tema) e aviso fixo; no chat, três painéis
  redimensionáveis (histórico, thread, citação), operáveis por teclado; abaixo de 768 px, o histórico
  vira Sheet e a citação vira Drawer, sem desmontar a conversa.
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
  "reportar", linha do tempo e "O que mudou" (diff lazy). Badge, texto, linha do tempo e diff são os
  componentes de `src/components/provision/` (`ValidityBadge`, `ProvisionText`, `ProvisionTimeline`,
  `ProvisionDiff`), os mesmos da página de dispositivo.
- **Histórico:** `ConversationList` (`GET /v1/conversations`) no painel esquerdo do chat (primeira
  página, conversa aberta marcada, link para o resto; no Sheet, abrir uma conversa o fecha por
  `useCloseHistoryPanel`) e em `/history/` com "Carregar mais"; abrir uma conversa vai para
  `/chat/?c=<id>`.
- **Dispositivo e comparação:** `/provision/?k=&ref=` mostra a redação vigente na data (ou a anterior
  mais próxima, com aviso), o badge (vigente, encerrada ou futura, com o último dia incluído), "O que
  mudou" montado só no clique e a linha do tempo, que troca o `ref`; sem `k`, a busca de dispositivos
  (`useDeferredValue`). `/compare/?k=&from=&to=` compara duas datas, com o exemplo do roteiro. Datas
  de calendário são formatadas em UTC (`calendarDate`), para o fuso não trocar o dia.
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
  `setRequestLocale`, `timeZone: 'America/Sao_Paulo'`. Testes de paridade de chaves en/pt-BR (todos
  os namespaces, com o diff do que falta e do que sobra, e as mesmas tags de rich text) e de uma
  chave `errors.<code>` por `ErrorCode`. Na mesma origem da Vercel, `/pt-BR/` mantém a caixa.
- Datas por `src/lib/i18n/format.ts`: data de calendário sem deslocamento de fuso, instante no fuso
  de exibição e período de apuração `MM/AAAA` (ou por extenso no idioma da UI).
- Páginas legais e "Sobre" (`legal-pages.tsx`): texto em Source Serif, sumário com âncoras, versão
  dos Termos de `@teko/shared/legal` (a mesma que a API exige). Os namespaces `legal` e `about` são
  renderizados só no servidor e ficam fora das mensagens do `NextIntlClientProvider`.
- WCAG 2.2 AA: região `aria-live="polite"` anuncia início e fim da resposta, `aria-busy` no stream,
  foco no composer, skip link, critérios 2.4.11, 2.5.8, 2.5.7 e 3.3.8; trechos legais com
  `lang="pt-BR"` também na UI em inglês (tag `<ptBR>` nos catálogos).

## Analytics e orçamentos

- **Consentimento** (F5): banner LGPD com Aceitar, Recusar e Personalizar de mesmo peso,
  preferências por categoria (medição de uso e pesquisas) em `localStorage['teko-consent']` com a
  versão da política, e "Preferências de cookies" nos rodapés. Nada é gravado antes da escolha.
- **Adapter** `src/lib/analytics/`: o único lugar que pode carregar o SDK (o Biome barra
  `posthog-js` fora dele), por `import()`, só com `analytics: true` e `NEXT_PUBLIC_POSTHOG_KEY` no
  build. Na F5 o cliente é no-op; o SDK entra na F6.
- **PostHog** (EU, F6), direto: `disable_external_dependency_loading: true`,
  `cookieless_mode:'on_reject'`, `person_profiles:'identified_only'`, replay desligado, desligado no
  staging (sem a chave), surveys só com consentimento. Eventos em
  [observabilidade](observabilidade.md).
- **Orçamento:** JS gz total do first-load, checado no pós-build: a soma do gzip da união dos chunks
  que os HTML do export carregam (`<script src>` sem `nomodule` e preload de script), cada chunk uma
  vez, contra `apps/web/bundle-budget.json` (500 KiB desde 2026-11-15, por decisão do mantenedor, com as telas da F5; a landing da F4 media 132 KiB). Os
  `import()` sob demanda ficam de fora. As
  metas de Web Vitals (LCP ≤ 2,0 s, INP ≤ 150 ms, CLS ≤ 0,05, primeiro token ≤ 1,5 s) são
  acompanhadas em produção pelo evento `web_vital`. Lighthouse CI e orçamentos por rota ficam para
  depois da v0.1.0.
