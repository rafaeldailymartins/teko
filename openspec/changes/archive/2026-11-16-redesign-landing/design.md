# Design

## Context

A onda 1 do redesign deixou os tokens, a logo, os cabeçalhos e o shell; a landing ficou correta, mas
genérica. Esta onda refaz a landing e as páginas públicas sobre essa fundação, sem paleta própria. Em
paralelo, outros dois agentes fazem a entrada/onboarding/configurações e as telas internas do app;
esta mudança não toca nelas nem nos componentes do chat.

Documentação consultada (Context7): React `/react/react/v19.3.1` (`useSyncExternalStore` com
`matchMedia`, limpeza de efeitos com timers e observers), next-intl `/amannn/next-intl/v4.14.9`
(`t.rich` com tags e valores no servidor), Playwright `/microsoft/playwright` (`reducedMotion` em
`test.use` e `emulateMedia`) e Tailwind CSS `/tailwindlabs/tailwindcss.com` (utilidades `mask-*`
das bordas e máscaras radiais).

## Decisions

- **Roteiro pré-calculado e player com relógio injetável.** `buildDemoSteps` transforma a pergunta
  e o número de palavras de cada resposta numa lista de quadros (`phase`, caracteres digitados, chip
  da data, trocas com cabeçalho, palavras e fontes) com o tempo de cada um. O `DemoPlayer` só agenda
  o próximo passo, com motivos de pausa que se somam (fora da tela, aba oculta, usuário) e um modo de
  movimento reduzido que vai ao quadro final e para. Os dois são lógica pura em `src/lib/landing/`,
  testada sem DOM (sequência, chip depois da digitação, stream, quadro final, pausas, movimento
  reduzido). Sem biblioteca de animação: React e transições de CSS bastam.
- **Quadro final no servidor, animador sob demanda.** O quadro final (as duas respostas completas,
  com a data 01/2010) é o do HTML estático, o do movimento reduzido e o primeiro do loop (fica 2,2 s
  antes de recomeçar). A apresentação (`demo-view.tsx`) não tem `'use client'`: o servidor a desenha
  e o animador (`chat-demo.tsx`) a reusa, com o mesmo DOM. `HeroDemoMount`, o único componente de
  cliente da landing, carrega o animador num `import()` depois da hidratação, e só sem movimento
  reduzido. Com o animador no primeiro acesso, o JS gz total ia de 434,4 para 447,7 KiB; com o
  `import()`, fica em 440,5 KiB (o animador é um chunk de 8,5 KiB gz sob demanda). Os 6 KiB que
  sobram são, na maior parte, o chunk próprio que o Turbopack cria para uma página com um
  componente de cliente a mais, repetindo o menu do celular do cabeçalho.
- **Axe estável no meio da animação.** O texto nunca fica translúcido: as entradas usam
  `animate-in` com deslocamento e sem `fade`, a conversa sai para cima com `translate`, e não há
  animação infinita (o `settled` do `a11y.spec.ts` espera as animações em curso terminarem). O
  cursor e o "pensando" são formas estáticas. A janela é `aria-hidden` e não tem nada focável; o
  botão de pausa fica fora dela, e o resumo `sr-only` (com `lang="pt-BR"` no nome do regulamento
  em inglês) diz o que a animação mostra.
- **Caso real e conferido.** O RCTE, art. 76, § 6º: 05/2008 cai na redação de 04/11/2004 a
  22/11/2009 (R$ 40.000,00, GOYAZES ou PROESPORTE) e 01/2010 na revogação de 23/11/2009. As datas
  ficam em `demo-case.ts` e um teste as compara com a fixture do corpus
  (`apps/api/test/fixtures/corpus/documents/rcte.json`). O cabeçalho da resposta reusa as mensagens
  do chat (`chat.answer.referencePeriodo`, `validity`, `citations`), e o badge mostra o intervalo
  em verde-folha com "Vigente em 05/2008": vigente na data de referência, que é o que a demonstração
  quer mostrar (o `ValidityBadge` do chat mede contra hoje).
- **Componentes visuais do chat replicados, não importados.** `CitationChip` e `ValidityBadge` são
  interativos (hover card, botão) e mudam com a onda das telas internas; dentro de uma região
  `aria-hidden` eles virariam foco escondido. A demonstração copia a forma (chip numerado em mono,
  bolha, cabeçalho em `text-xs`, badge de vigência) com os mesmos tokens.
- **Régua do corpus estática.** A landing não chama a API; a régua usa o ano aproximado do texto mais
  antigo de cada família no corpus (`src/lib/landing/corpus.ts`, com as fontes no comentário) e
  manda para a página de cobertura, que tem as datas exatas e as lacunas.
- **Páginas de texto longo.** Cabeçalho editorial (sobretítulo, título em serif, versão com o ponto
  âmbar), sumário fixo ao lado do texto no desktop (`lg:sticky`) e antes dele no celular, marca por
  seção (`§ n` nos textos legais, `01` no "Sobre") fora do `h2` e do link do sumário, para o título
  da seção continuar igual ao item do sumário. "Voltar ao topo" fica fora do `<nav>` do sumário. O
  texto dos catálogos não muda.
- **`bg-surface-gradient` em `oklab`.** Em `oklch`, a mistura de dois neutros quase sem croma dá
  matiz `none`, que o Chromium pinta como 0: um rosado visível nas faixas. Em `oklab`, sem matiz,
  o gradiente fica no tom frio dos tokens.
- **FAQ exclusivo por `name`.** `<details name="landing-faq">` abre uma pergunta por vez sem
  JavaScript, e continua legível sem ele.

## Risks / Trade-offs

- A régua do corpus pode ficar defasada quando a cobertura mudar muito; o texto diz que os anos são
  aproximados e aponta para a cobertura exata.
- O Turbopack repete parte do cabeçalho no chunk próprio da landing (cerca de 6 KiB gz). Evitar isso
  exigiria pôr o ponto de montagem num componente comum a todas as páginas públicas, o que não vale
  a complexidade com o orçamento em 440 de 500 KiB.
