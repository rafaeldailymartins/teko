# Design

## Context

O redesign das telas do app (`redesign-app-screens`) deixou o chat completo, mas carregado: tudo
aparecia ao mesmo tempo. Esta mudança só reorganiza a apresentação; o transporte, as rotas da API,
o cliente gerado, os hooks e os itens da lista do histórico ficam como estão (outro trabalho em
paralelo mexe neles).

Documentação consultada (Context7): react-resizable-panels `/bvaughn/react-resizable-panels`
(painéis renderizados condicionalmente no `Group` da v4, tamanhos em `%` como string). O resto
(next-intl `useFormatter().list`, Base UI Drawer e Sheet, lucide) segue o uso que já existia no
repositório.

## Decisions

- **A citação toma o lugar do histórico.** Duas colunas no máximo: abrir uma citação no desktop põe
  o painel dela à direita da conversa, num `ResizablePanel` com o separador (mouse e teclado), e o
  histórico vira o trilho até a citação fechar. "Mostrar o histórico" com a citação aberta fecha a
  citação. A conversa continua no mesmo lugar da árvore (o painel `thread` é sempre o primeiro do
  grupo), então nada é remontado.
- **`Esc` sem conflito.** O `Esc` que fecha a citação ouve na `window`, depois dos ouvintes do
  `document`, e só vale com o foco no painel, num chip, numa fonte ou em lugar nenhum. O `Esc` que
  para a resposta (ouvinte do `document`) marca o evento como tratado, e o do painel o ignora. Ao
  fechar com o foco dentro do painel, o foco volta ao chip ou à fonte da citação aberta.
- **Histórico recolhido lembrado.** `teko-history-panel` = `collapsed` no `localStorage`, lido e
  gravado com `try/catch` (`src/lib/history-panel.ts`): storage bloqueado vale como aberto e a troca
  continua funcionando na página. O foco acompanha o botão de recolher/abrir, que troca de lugar.
- **Sem botão "Citação" no celular.** O Drawer abre só pelo chip ou pela fonte; um botão que abria
  um painel vazio não ajudava.
- **A data num lugar só.** A abertura do chat vazio fica com o selo, a saudação e uma linha. O chip
  do composer já mostra a data e o "padrão: mês anterior", e a régua do corpus
  (`corpusTimelinePosition`) saiu com o seu teste.
- **Metadados em texto.** A linha da resposta usa `text-xs` apagado; o rótulo "Período de apuração"
  vai em `sr-only` antes da data, para o leitor de tela ouvir o que é. "Resposta em cache" não muda
  o conteúdo: fica no `title` da linha e num `sr-only`; "Somente busca lexical" e "Modelo de
  reserva" continuam visíveis na linha, porque afetam a qualidade. As chaves antigas de
  `chat.answer` (`referencePeriodo`, `validity`, `source.*`) continuam, porque a demonstração da
  landing as usa.
- **Nomes legíveis das famílias.** A nota de cobertura parcial usa `familyMessageKey` e
  `coverage.families.<chave>.name`, os mesmos da página de cobertura, numa lista do `Intl`
  ("EFD ICMS/IPI, EFD-Reinf e Tabelas de Goiás"); família nova fica com o código.
- **Fontes recolhidas.** O botão "N fontes" controla a lista (`aria-expanded`, `aria-controls`); a
  lista fechada fica `hidden`. Cada linha estende o botão sobre ela (um alvo grande, o nome "Fonte n:
  dispositivo"); a vigência fica fora do botão, para o nome não mudar. Recusada pelo validador sai
  riscada em `text-muted-foreground`.
- **Aviso de parecer.** No chat, uma linha `text-xs` logo abaixo do composer (o composer fixo
  embaixo a mantém à vista). Nas outras páginas do app, o `AppDisclaimer` no fim do `<main>` (que
  passa a ser `flex-col`, com o aviso em `mt-auto`); ele não aparece no chat, para não repetir.
- **Cookies no menu da conta.** `useOpenConsentPreferences()` expõe a ação do `ConsentProvider`; o
  menu da conta mostra "Preferências de cookies" logo abaixo de Configurações. O rodapé do site
  continua com o link.

## Bundle

O chat continua fora do first-load. A mudança remove mais código do que adiciona (régua, ícones de
família, rótulos de degradação em pílula e a grade de cartões); a soma do pós-build está no
pós-build fica em 461,7 KiB gz de 500 KiB (era cerca de 460 antes da mudança).

## Verificação local

Os e2e afetados (`chat.spec.ts`, `shell.spec.ts`, `consent.spec.ts` e o axe do chat em
`a11y.spec.ts`) passaram contra um `next dev` com uma API local própria. O axe pegou o alvo de uma
fonte coberta pelo composer fixo: a linha da fonte ganhou 24 px de altura mínima, e a rolagem da
conversa reserva o espaço do composer (`scroll-pb-44`), para o foco por teclado não ficar atrás
dele.
