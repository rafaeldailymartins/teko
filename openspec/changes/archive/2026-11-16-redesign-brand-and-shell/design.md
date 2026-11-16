# Design

## Context

O front da F5 está completo (shell, chat, histórico, autenticação, legais), mas com o visual
genérico do registry e textos de "em construção". O mantenedor pediu um redesign profissional a
partir da logo (`docs/assets/logo.svg`: um T cuja barra é uma linha do tempo, a data de referência
em âmbar no centro e folhas brotando da haste). Esta onda faz a fundação; em paralelo, outro agente
faz o backend do login por e-mail e senha, e as ondas seguintes refazem a landing e as telas
internas sobre estes tokens e componentes.

Documentação consultada (Context7): Next.js `/vercel/next.js/v16.4.5` (redirects com `has` de
header, convenções de ícones de metadados), Base UI `/mui/base-ui/v1.9.0` (`Menu.LinkItem`),
tailwind-merge `/dcastil/tailwind-merge/tailwind-merge_3.7.0` (`extendTailwindMerge` com o tema) e
Tailwind CSS `/tailwindlabs/tailwindcss.com` (`@theme static`, `@keyframes` no `@theme`, `@utility`).

## Decisions

- **Paleta da logo convertida para OKLCH, o par claro/escuro em `light-dark()`.** A primária do
  claro é o próprio `#005766` (`oklch(0.42 0.074 214.6)`); no escuro, o verde-água claro da folha
  (`#7fd8c8`), que lê bem sobre o petróleo profundo (`--background` escuro `oklch(0.2 0.032 215)`,
  perto de `#021c22`). Neutros com croma baixo e matiz 200–216, nunca cinza puro. O teste de
  contraste não mudou de limiar; ganhou os pares da marca (`--brand-foreground` sobre `--brand` e
  `--brand-deep`), a folha como forma (≥ 3:1 sobre fundo, painel e popup), a primária sobre popup e
  o selo "vigente" (`--validity-current` sobre `--leaf-soft`).
- **Tokens de marca separados da primária.** `--brand`/`--brand-deep` são superfícies de destaque
  com texto claro nos dois temas (o selo, o botão `brand`, telas da marca); a primária continua
  sendo a cor de ação e de texto de link, que no escuro precisa ser clara. `--leaf` é forma, não
  texto (para texto, `--validity-current`). `--date-mark` é o ponto âmbar decorativo, sempre ao lado
  de um texto com a data; o âmbar continua reservado para data e vigência.
- **Sombras e gradientes como utilidades do tema.** `shadow-soft`, `shadow-raised` e
  `shadow-overlay` são camadas tingidas de petróleo (no escuro, mais densas e sem tinta), via
  `--shadow-tint`. Gradientes por `@utility` (`bg-brand-gradient`, `bg-leaf-gradient`,
  `bg-surface-gradient`, `bg-brand-glow`, `timeline-rule`), só CSS. O `cn` estende o
  tailwind-merge com essas sombras, a curva `ease-out-soft` e a animação `timeline`, para
  `shadow-none` anular `shadow-soft` como esperado.
- **Movimento curto e reduzido de verdade.** Transições de 150–250 ms com `ease-out-soft`; um bloco
  `prefers-reduced-motion` em `@layer base` zera animações e transições (com `!important`, a única
  forma de valer sobre as utilidades; suprimido no Biome com o motivo). Sem biblioteca de animação.
- **Logo como componente, sem `<style>`.** `TekoLogo` desenha o SVG inline com gradientes em
  `<defs>` e ids por `useId` (várias logos na página não se cruzam). Variante `seal` é a logo
  completa; `mark` é o ícone compacto (uma folha, traços mais grossos) para 20–32 px. Sem `title`, é
  decorativa (`aria-hidden`); com `title`, `role="img"` e `aria-label`. O `<title>` interno fica
  sempre (dica do mouse e a regra `noSvgWithoutTitle`).
- **Ícones em `public/` por `metadata.icons`, não `src/app/icon.svg`.** O Next registra os arquivos
  de convenção de ícones como route handlers no `app-path-routes-manifest.json`, e o guard do
  estático (`scripts/lib/static-guard.ts`) recusa qualquer route handler. Afrouxar o guard por
  causa de um favicon não vale: `SITE_ICONS` em `src/lib/site.ts` aponta `public/icon.svg` (cópia da
  logo) e `public/apple-icon.png` (180 px, fundo até a borda), usados pelo layout de locale, pela
  entrada `/` e pelo 404 global. A imagem do Open Graph (`public/og.png`, 1200 × 630) entra no
  `openGraph.images` com `metadataBase`, e o `twitter` usa `summary_large_image`. Os três arquivos
  saem de `scripts/brand-assets.ts` (Chromium do Playwright, sem serviço externo).
- **Cabeçalho do site fixo e translúcido; o do app com abas.** Site: marca, navegação de texto
  (página atual com sublinhado verde-folha), código-fonte, idioma, tema e "Abrir o Tekó" no botão
  `brand`; abaixo de 768 px um Sheet com as páginas, o código-fonte e a chamada. App: marca, abas
  em relevo (a atual em `--popover` com `shadow-soft`), a busca da paleta com cara de campo, idioma,
  tema e a conta. Os dois terminam no fio `timeline-rule`, o motivo da logo. Contêiner do site:
  `max-w-5xl px-5`, o mesmo das páginas.
- **Menu de idioma com links do Base UI (`Menu.LinkItem`).** Navegação completa de propósito (o
  idioma muda o `<html lang>`). O destino leva a query e a âncora atuais: a query do Tekó só tem ids
  e datas (`url-state.ts`), nunca o texto da pergunta, e a navegação fica na mesma origem, então o
  motivo antigo para descartá-la não vale mais. A query é lida de `window.location` quando o menu
  abre, então o HTML estático não precisa de `useSearchParams` (nem de `<Suspense>`) por causa dele.
  `switchLocaleHref` é a função pura testada.
- **Raiz sem tela de idioma em todo lugar.** Em produção, Vercel, Caddy e Plano B já respondem 302
  por `Accept-Language` (`policy.ts` da API, conferido). Em `next dev`, `redirects()` só de
  desenvolvimento com a mesma regra: `src/lib/i18n/root-locale.ts` copia `ACCEPT_LANGUAGE_EN` (o web
  não importa da API), e `scripts/root-locale.test.ts` prende as duas cópias. O `has` do Next casa o
  header inteiro (`^valor$`), então a expressão de dev troca o fim por `(?:[;,].*)?`. A página
  estática de `/` vira uma tela neutra (o selo, sem texto de escolha) com `public/root-locale.js`,
  que vai na hora para o idioma do navegador com a mesma regra; o script é externo porque a CSP só
  aceita inline com hash e o Semgrep só abre exceção para o script de tema. Sem JavaScript, o
  `<meta refresh>` (dentro do `<noscript>`) leva ao locale padrão e os links ficam no `<noscript>`.
- **`SessionGate` em volta do shell.** Antes era um irmão do conteúdo e só redirecionava depois da
  primeira pintura. Agora o app (cabeçalho, `<main>` e rodapé) é filho da guarda: com o `/me`
  carregando (o que inclui o HTML estático, onde não há sessão), a guarda pinta a `BrandScreen`
  (selo, linha do tempo com o ponto âmbar indo e voltando, "Carregando o Tekó…" num
  `role="status"`); sem sessão, a mesma tela enquanto `router.replace` leva à entrada com o retorno;
  com o `/me` indisponível, a tela com "Tentar de novo" (`refetchQueries` do `/me`). O app só
  aparece com a sessão pronta, e o onboarding pendente continua abrindo o diálogo.
- **Componentes de `ui/` com o acabamento novo, sem mudar a API.** Foco do botão em anel sólido com
  recuo (`ring-ring` + `ring-offset-background`, ≥ 3:1 nos dois temas), variante `brand`, alturas um
  degrau maiores; menus, diálogos, sheet, drawer, paleta, popover e tooltip com `shadow-overlay`,
  cantos maiores e o backdrop tingido de petróleo; títulos de diálogo em serif. `Card` entra com
  tons `default`, `raised` e `muted` (usado nas seções das configurações). `Badge` ganha o tom
  `leaf`. O `GitHubIcon` (Octicons, MIT) cobre a falta de ícones de marca no lucide 1.x.
- **Orçamento de bundle.** O primeiro acesso foi de 416,4 para 433,9 KiB gz (teto de 500): o menu do
  celular (Sheet) e o menu de idioma entram nas páginas do site, e a tela da marca no shell.

## Risks / Trade-offs

- O HTML estático das páginas do `(app)` não leva mais o esqueleto da conversa, e sim a tela da
  marca. É o que evita o flash; o custo é não ver o layout antes da hidratação.
- Sem JavaScript o menu de idioma não abre (antes eram links soltos). O `hreflang` no `<head>`
  continua apontando a outra versão para buscadores, e a entrada `/` tem os links no `<noscript>`.
