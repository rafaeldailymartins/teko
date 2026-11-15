# Proposal

## Why

A F5 pede o chat completo sobre a API da F4: perguntar numa data de referência, ver a resposta
chegar em stream com as citações numeradas, abrir cada citação com o intervalo de vigência e
confirmar, no DoD, que a mesma pergunta em 05/2008 e em 01/2010 muda a resposta, a citação e o
intervalo. Até aqui o painel central do workspace é só um estado vazio, e o `fetch(` fora de
`src/lib/api` ainda não é barrado, embora o desenho prometa.

## What Changes

- Transporte do `useChat` (`src/lib/api/chat-transport.ts`, `TekoChatTransport`): `POST
  /questions` pelo SDK gerado; `answered`, `refused` e `needs_clarification` viram chunks
  sintetizados; `accepted` abre o stream na mesma origem e lê o UI Message Stream v1 com o parser e o
  schema do `ai`. Sem resume (`reconnectToStream` devolve `null`); a UI relê `GET /questions/:id`.
- Regra do Biome: `fetch(` só em `apps/web/src/lib/api/**` (`noRestrictedGlobals` com override),
  com teste de fronteira.
- Thread e composer no painel central: bolha otimista, `aria-busy` e região viva, parar (`Esc`),
  `Ctrl/⌘+Enter`, `/`, skeletons, `ErrorBoundary` por bloco, feedback, sugestões sensíveis à data,
  detector de PII com aviso antes de enviar.
- Markdown com Streamdown e `@streamdown/code` (Shiki com motor de regex em JS), `rehype-harden`
  com os prefixos permitidos, sem imagens; `cite:<id>` vira `CitationChip` com hover card.
- Data de referência: chip fixo, month picker com data exata, atalhos, `Alt+D`, `source:'default'`
  enquanto o usuário não mexe, data inferida do texto em âmbar, botões do `needs_clarification`,
  cabeçalho da resposta com data e vigência, estado na URL (`ref`, `q`, `c`).
- Cobertura no composer e `CoverageBanner`; rótulos de degradação; cota e serviço pausado
  desabilitam o composer com o reset; recusa com o motivo.
- Painel de citação (painel direito, Drawer no celular) com documento, versão, badge de vigência,
  texto em `lang="pt-BR"`, campos, fonte, copiar, reportar, `[`/`]` e o link para a página do
  dispositivo.
- Tudo do chat carrega sob demanda (`next/dynamic`), fora do primeiro carregamento.
- Cliente gerado com imports `.ts` (`module.extension`): o padrão `.js` não resolvia no Turbopack
  quando uma página passou a importar o SDK.

## Capabilities

### New Capabilities

- `web-chat`: a experiência do chat no web (transporte, thread, composer, data de referência,
  cobertura, citações e degradação).

## Impact

- `apps/web`: `src/lib/api/{chat-transport,mutations}.ts`, `queries.ts`/`hooks.ts` (cota),
  `src/lib/chat/**`, `src/lib/hotkeys.ts`, `src/components/chat/**`, `src/components/ui/{popover,
  hover-card,textarea,skeleton}.tsx`, `workspace.tsx` (Drawer controlado), `pages/chat-page.tsx`,
  `globals.css` (`@source` do Streamdown), `biome.json`, `openapi-ts.config.ts` e o cliente gerado,
  `messages/*.json` (namespace `chat`), `e2e/chat.spec.ts`.
- Dependências: `@ai-sdk/react`, `ai` (já no catálogo), `streamdown`, `@streamdown/code` e
  `rehype-harden`.
- Docs: `docs/architecture/frontend.md` e `docs/status.md`.
