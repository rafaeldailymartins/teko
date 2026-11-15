# Design

## Context

O `apps/web` tinha a landing, o 404 por locale, o script de tema, o skip link e os tokens de domínio
com teste de contraste, mas nenhum componente interativo, nenhum provider de cliente e nenhuma
página além da inicial. Três agentes trabalham em paralelo na onda 1 da F5: esta mudança (design
system e shell), a camada de dados (`src/lib/api/**`, TanStack Query) e os headers e o CSP do build.

## Decisions

- **Componentes copiados do registry, sem o CLI do shadcn.** O `shadcn` não entra no lockfile da
  aplicação (nada de `npx` fora de lockfile, ADR 0002). Os fontes vieram do registry `base-nova`
  (`ui.shadcn.com/r/styles/base-nova/<nome>.json`) e foram adaptados: `cn` de `@/lib/utils`, ícones
  do `lucide-react` no lugar do `IconPlaceholder`, textos acessíveis (como "Fechar") por prop vinda
  do catálogo, e só as partes que o app usa exportadas (o knip reprova export morto). O command do
  registry usa o input-group; aqui o campo de busca vem embutido, que é o único uso.
- **`clsx` + `tailwind-merge` no `cn`, não o pacote `cn` novo do shadcn.** O `cn` 0.5 tem 13 dias e
  é 0.x; os dois clássicos são maduros, e o brief da F5 os pede.
- **Destaque de menu e paleta em `--muted`, não em `--accent`.** No shadcn o `accent` é o hover dos
  itens; no Tekó o acento âmbar é reservado para data de referência e vigência (desenho do
  front). Os componentes copiados usam `bg-muted` no item destacado.
- **Tokens novos com o mesmo formato `light-dark()`**, lidos pelo `tokens.test.ts`: os pares de
  texto (≥ 4,5:1) e de UI e foco (≥ 3:1) cobrem popups, hover, campos, secundária, destrutiva, e os
  tokens de domínio sobre fundo, painel lateral, popup e bloco de resposta, nos dois temas.
- **Fontes por `next/font/google`, que já é self-hosted.** O Next baixa os arquivos no build e os
  serve da própria origem; nenhum pedido ao Google em runtime (`font-src 'self'`). Os pacotes npm
  com os arquivos (`geist`, `@fontsource-variable/*`) são OFL-1.1, fora da allowlist de licenças do
  `dependency-review`; incluí-los pediria mudar o workflow de segurança, que não é desta mudança.
- **Base UI sem `<style>` em runtime.** O `CSPProvider disableStyleElements` desliga a única regra
  que o Base UI injetaria (a que esconde a barra nativa da ScrollArea), e ela mora em `globals.css`.
  Assim o CSP com hash dos `<style>` inline do pós-build continua valendo para tudo o que roda no
  cliente. O `style-src-attr 'unsafe-inline'` já previsto cobre os estilos de atributo dos painéis
  e do posicionamento dos popups.
- **App shell como layout do grupo `(app)`.** chat, history, settings, provision e compare ficam
  em `src/app/[locale]/(app)/…`, e o layout (cabeçalho, `<main>` com rolagem e aviso fixo) fica
  montado entre elas. As URLs não mudam. As públicas (coverage, about, privacy, terms, sign-in)
  usam o cabeçalho e o rodapé do site, como a landing.
- **Três painéis só na página do chat.** O `Workspace` (histórico | conversa | citação) é usado pela
  página do chat; settings e as demais não têm citação para mostrar. O HTML estático sai com o
  layout de desktop; uma regra CSS esconde os painéis laterais abaixo de 768 px antes da hidratação
  (sem salto de layout no celular), e depois o `useMediaQuery` tira os painéis da árvore e liga o
  Sheet e o Drawer. A conversa fica sempre na mesma posição da árvore e não perde estado quando a
  janela cruza o ponto de quebra.
- **Teclado nos painéis pelo próprio `react-resizable-panels`.** O separador segue o padrão window
  splitter da WAI-ARIA (setas, Home/End, Enter recolhe o painel) e recebe nome acessível do catálogo.
- **Paleta com `cmdk` dentro do Dialog do Base UI**, como no registry. `Ctrl/⌘+K` alterna a paleta
  (sem Alt nem Shift); o botão do cabeçalho tem `aria-keyshortcuts`. Ela navega entre as páginas e
  troca o tema. O rótulo do atalho segue a plataforma depois da hidratação (`⌘K` ou `Ctrl K`).
- **Tema por `useSyncExternalStore`.** O seletor e a paleta leem a preferência do `localStorage`
  sem divergência de hidratação (o HTML estático diz "sistema"), gravam pelo `applyThemePreference`
  e avisam as outras instâncias por um evento da `window`; o evento `storage` cobre outras abas. O
  script inline e o hash dele não mudam.
- **Troca de idioma mantém a página.** `switchLocalePath` troca só o primeiro segmento, sem a query
  (que pode levar dados da conversa).
- **`providers.tsx` é o ponto de extensão.** Hoje tem o `CSPProvider` e o `TooltipProvider`; o
  provider do TanStack Query da camada de dados entra nele. O `NextIntlClientProvider` fica no
  layout de locale (servidor) e herda locale, mensagens e fuso do `i18n/request.ts`.
- **Motion fica de fora.** Nada desta mudança anima além das transições CSS dos popups
  (`tw-animate-css`), então a dependência não entra agora.
- **Rota `/coverage/` e o `.gitignore`.** O padrão `coverage/` (relatórios de teste) engolia
  `src/app/[locale]/coverage/`. O `.gitignore` ganhou a exceção, e o `biome.json` e o Sonar passaram
  a excluir só os `coverage/` dos pacotes.
- **Testes de componente em happy-dom**, só nos arquivos que pedem (`// @vitest-environment`), com
  `react-dom/client` e `act`, sem Testing Library. Os componentes de servidor assíncronos (páginas e
  layout do shell) ficam fora da cobertura unitária, como os que já existiam, e são cobertos pelo
  build e pelos e2e.

## Risks / Trade-offs

- O `NextIntlClientProvider` sem `messages` explícitas manda o catálogo inteiro no payload de cada
  página. Hoje ele é pequeno; se crescer, o layout passa a escolher os namespaces de cliente.
- O `cmdk` traz primitivos do Radix como dependências transitivas, ao lado do Base UI. É o que o
  registry Base UI do shadcn usa; uma paleta sobre o Autocomplete do Base UI é alternativa futura.
- `cmdk`, `class-variance-authority`, `clsx` e `react-resizable-panels` não publicam proveniência
  (nenhuma versão), o que o `trustPolicy: no-downgrade` aceita.
- Em happy-dom os popups do Base UI não animam; os testes esperam um tique antes de conferir.

## Context7

| Biblioteca             | ID                                                  | Consulta                                                                    |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| shadcn/ui              | `/websites/ui_shadcn`                               | command em diálogo, instalação manual no Tailwind 4, `tw-animate-css`, `cn` |
| Base UI                | `/websites/base-ui_react`                           | Menu com RadioGroup e `render`, portais e `isolation`, `CSPProvider`        |
| react-resizable-panels | `/websites/deepwiki_bvaughn_react-resizable-panels` | API da v4 (`Group`, `Panel`, `Separator`, tamanhos em %), teclado           |
| next-intl              | `/amannn/next-intl/v4.14.9`                         | `NextIntlClientProvider` herdando config de um Server Component             |
| cmdk                   | `/dip/cmdk`                                         | `Command.Item` com `value`, `keywords` e `onSelect`                         |
| happy-dom              | `/capricorn86/happy-dom/v21.0.3`                    | `happyDOM.setViewport` e `matchMedia`                                       |
