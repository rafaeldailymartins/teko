# Design

## Context

Desenho em `docs/architecture/frontend.md` (Dados e streaming, UX, i18n e acessibilidade) e
contratos em `packages/shared/src/contracts/{questions,stream,citations,coverage}.ts`. A onda 1 da
F5 deixou o shell com o workspace em três painéis, o cliente gerado, o `ApiError`, os parsers do nuqs
e a CSP por documento (sem `'unsafe-eval'`, `connect-src 'self'`, `<style>` só com hash). Esta
mudança é a onda 2 do chat; histórico, dispositivos, login, settings e páginas legais são de outros
agentes.

## Decisions

- **Transporte próprio.** `TekoChatTransport implements ChatTransport<TekoUIMessage>`: o
  `askQuestion` do SDK (com o interceptor de `ApiError`) decide o caminho; as respostas síncronas
  viram chunks pelo mesmo `partsToChunks` que monta a releitura do histórico, então o `useChat`
  trata cache hit, recusa, esclarecimento e stream de um jeito só. O stream é `fetch` same-origin
  com `credentials: 'same-origin'`, `parseJsonEventStream` + `uiMessageChunkSchema` do `ai` e um
  `TransformStream` que desembrulha o `ParseResult` (chunk inválido derruba o stream). Resposta não
  OK do stream vira `ApiError` pelo mesmo `toApiError` do cliente. O `context()` lê locale e data no
  envio (um ref atualizado por efeito, e na hora pelos atalhos que trocam a data e já enviam).
- **`data-clarification` só do cliente.** `needs_clarification` não tem `questionId` nem chunk na
  API; o transporte sintetiza um data part local (schema em `src/lib/chat/parts.ts`, validado pelo
  `dataPartSchemas` do `useChat` junto com os de `tekoDataPartSchemas`). A escolha volta por
  `sendMessage(..., { body: { clarifiedDate } })` e vai como `source: 'clarified'`.
- **Mensagem do assistente com o id da pergunta.** O `start` do stream (e o sintetizado) leva
  `messageId = questionId`; feedback, "reportar" e "recarregar a resposta" usam esse id. O `onFinish`
  grava `q` e `c` na URL. Ao abrir com `q`, a pergunta é relida (`GET /questions/:id`) e vira
  mensagens; depois de um erro, "Recarregar a resposta" relê e troca o par.
- **Data de referência.** `null` no `ref` = default: o corpo vai com o mês anterior e `source:
  'default'` (a API ignora o valor e resolve o próprio default ou a data do texto). Período escolhido
  vai como `periodo_apuracao`, data exata como `explicit`. "Último período fechado" usa o prazo geral
  de entrega da EFD ICMS/IPI (dia 25 do mês seguinte): até ele, é o retrasado. A data inferida do
  texto (`source: 'question_text'` no `data-reference-date`) fica em âmbar no cabeçalho e o composer
  oferece "Confirmar", que fixa o chip (dia 1 vira período).
- **Vigência do cabeçalho.** A interseção dos intervalos das citações válidas: o período em que
  todas as redações citadas valem juntas (todas contêm a data de referência).
- **Cobertura.** `coverageAt` compara a data efetiva do chip com `GET /coverage`: fundamentada,
  parcial ou fora. O composer mostra o indicador e, fora de cobertura, o banner; a resposta mostra o
  banner parcial a partir de `meta.uncoveredFamilies`. Nada bloqueia o envio.
- **Cota e pausa.** `quota_exceeded` e `service_paused` desabilitam o composer; o reset vem do
  `meta.resetAt` do Problem Details ou de `GET /me/quota` (consultada só nesse estado), e um timer
  reabilita no horário.
- **Markdown seguro dentro da CSP.** Streamdown 2.7.1 com `rehypePlugins` = `sanitize` + `harden`
  (sem `rehype-raw`: HTML cru sai como texto, nunca como elemento), `controls={false}` e
  componentes próprios: `a` troca `#cite-Sn` pelo chip e só emite `<a>` se o href casar um prefixo
  permitido (segunda barreira depois do harden, que deixaria `mailto:` passar); `img` não renderiza.
  O link `cite:S1` vira `#cite-S1` antes do parse porque o sanitizador e o `urlTransform` descartam
  protocolos desconhecidos. Conferido no código instalado: o Streamdown e o `@streamdown/code` não
  injetam `<style>` nem usam `eval`/`new Function`; o plugin de código usa o
  `createJavaScriptRegexEngine` do Shiki (sem WASM), e as cores dos tokens saem em atributo `style`
  (permitido por `style-src-attr`). Mermaid e math não entram.
- **`fetch(` só em `src/lib/api`.** `noRestrictedGlobals` com `fetch` no `apps/web/biome.json` e
  override `off` para `src/lib/api/**`; o `test/biome-boundary.test.ts` confere uma sonda barrada e
  outra liberada.
- **Bundle.** O `ChatWorkspace` (SSR, leve) guarda a citação aberta e monta o `Workspace`; a conversa
  (`chat-session.tsx`: AI SDK, `useChat`) e o painel de citação são `lazy(() => import(...))` dentro
  de um `ClientOnly` (`useSyncExternalStore` + `Suspense`: no HTML estático fica o esqueleto), e o
  markdown (Streamdown, Shiki) é outro `lazy` dentro da conversa, pré-carregado quando ela abre.
  Sem `next/dynamic`, o runtime dele (`BailoutToCSR`, preload) também fica fora. Os chunks sob
  demanda ficam fora da conta do orçamento.
- **Cliente gerado com `.ts`.** `output.module.extension: '.ts'` no `openapi-ts.config.ts`: com o
  `nodenext` herdado do `tsconfig.base.json`, o hey-api emitia `./client.gen.js`, que o Turbopack não
  resolve; o build quebrava no primeiro import do SDK por uma página. O resto do código já importa
  com `.ts`.
- **Tabela de campos.** O contrato da citação não traz campos de leiaute; o painel mostra a tabela
  com documento, versão, família e jurisdição e a chave estável.
- **Linha do tempo e "O que mudou".** Ficam com o agente de histórico e dispositivos
  (`src/components/provision/`); o painel leva o link `/<locale>/provision/?k=<stableKey>&ref=<data>`
  e o coordenador encaixa os componentes na onda 3.

## Medição do bundle

JS gz do primeiro acesso (união dos chunks dos HTML, pós-build), em 2026-11-15:

| Momento                                                | KiB gz |
| ------------------------------------------------------ | ------ |
| Antes (main com o workspace vazio)                     | 327,3  |
| Depois, com o painel de citação no first-load          | 353,4  |
| Depois, conversa e painel por `next/dynamic`           | 344,4  |
| Depois, conversa, painel e markdown por `lazy` (final) | 343,5  |

O aumento que fica (16,2 KiB) não é código do chat: o chunk exclusivo do `/chat/` (workspace,
resizable, drawer) já existia e passou de 42,3 para 44,2 KiB. O resto vem da nova divisão de chunks
do Turbopack: com o grafo sob demanda do chat, os módulos compartilhados (React Query, nuqs, Zod,
Base UI) se espalham por mais chunks (a landing foi de 13 para 17), e a soma gz de cada chunk
separado cresce (landing de 295,8 para 305,9 KiB na mesma contagem). O código do chat que carrega
sob demanda (AI SDK, Streamdown, Shiki e gramáticas por linguagem) não entra na conta; o chunk do
Streamdown sozinho tem 138 KiB gz.

## Context7

| Biblioteca         | ID                     | Consulta                                                                                                    |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| AI SDK             | `/websites/ai-sdk_dev` | `ChatTransport` próprio, `sendMessages`, `reconnectToStream`, `abortSignal`                                 |
| Streamdown         | `/vercel/streamdown`   | `rehype-harden` (`allowedLinkPrefixes`, imagens), `@streamdown/code`, `@source` do Tailwind 4, `components` |
| Next.js            | `/vercel/next.js`      | `next/dynamic` com `ssr: false` em componente cliente                                                       |
| Base UI            | `/mui/base-ui/v1.9.0`  | `PreviewCard` (hover card) e `Popover` controlado                                                           |
| Hey API openapi-ts | `/hey-api/hey-api`     | `output.module.extension` nos imports gerados                                                               |

As versões instaladas foram conferidas também pelos tipos e pelo código em `node_modules` (`ai`
7.0.164, `@ai-sdk/react` 4.0.168, `streamdown` 2.7.1, `@streamdown/code` 2.0.0, `rehype-harden`
1.1.9, Shiki 4.6.0).
