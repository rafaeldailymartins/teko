# Proposal

## Why

O mantenedor viu o chat redesenhado e achou a tela poluída, com informação demais e pouco intuitiva.
Três colunas sempre (com o painel de citação vazio ocupando um terço da largura), a data de
referência repetida no chat vazio, cartões de sugestão grandes, uma linha de estado e a dica do
atalho no composer, três pílulas de metadados e um aviso grande com códigos internos antes do texto
da resposta, as fontes numa grade de cartões e um rodapé fixo em todas as telas do app. O conteúdo
principal, a pergunta e a resposta, ficava em segundo plano.

## What Changes

- **Duas colunas no máximo.** O painel de citação só existe aberto, ao lado da conversa (com fechar
  e `Esc`); enquanto ele está aberto, o histórico vira um trilho estreito. O histórico pode ser
  recolhido por um botão, com a escolha lembrada no `localStorage`, e o trilho mantém o atalho de
  nova conversa. No celular, o histórico continua num Sheet e a citação num Drawer, aberto pelo chip.
- **A data uma vez só.** O chat vazio perde o selo grande da data e a régua de 1998 a hoje; a data
  fica só no chip do composer. A descrição vira uma linha.
- **Sugestões enxutas.** Quatro linhas finas, sem subtítulo, ícone de família nem badge: a pergunta
  do DoD com os dois períodos (05/2008 e 01/2010) e uma pergunta de cada outra família.
- **Composer limpo.** Texto, chip da data e enviar/parar. Saem a linha de cobertura e a dica do
  atalho (que vai para o `title` e o `aria-keyshortcuts` do botão); o contador só aparece perto do
  limite. Os avisos de cota, data fora da cobertura, data inferida e dados pessoais continuam, só
  quando acontecem.
- **Resposta com o texto em primeiro plano.** Uma linha discreta de metadados ("05/2008 · vigência
  desde 23/09/2005", com o ponto âmbar); "Resposta em cache" sai da vista (fica na dica da linha e
  para leitor de tela); a cobertura parcial vira uma nota de uma linha com os nomes legíveis das
  famílias (os da página de cobertura).
- **Fontes recolhidas.** Uma linha "12 fontes" que abre uma lista de uma coluna (número, dispositivo
  e vigência); a linha abre a citação. As citações recusadas continuam riscadas, em tom apagado.
- **Aviso de parecer discreto.** "Apoio à consulta; não constitui parecer" sai da barra fixa: no chat
  fica numa linha pequena abaixo do composer, sempre à vista; nas outras páginas do app, no fim do
  conteúdo. "Preferências de cookies" vai para o menu da conta.

## Capabilities

### Modified Capabilities

- `web-chat`: composer, data usada, cobertura e degradação, citações, fontes, abertura e sugestões.
- `web-shell`: aviso do app shell e área de trabalho do chat (duas colunas; celular sem o botão de
  citação vazia).
- `web-consent`: o link das preferências de cookies no app passa do rodapé para o menu da conta.

## Impact

- `apps/web`: `src/components/app-shell/` (workspace, layout e o aviso), `src/components/chat/`
  (abertura, sugestões, composer, cobertura, mensagem, fontes e a área de trabalho),
  `auth/user-menu.tsx`, `consent/consent-provider.tsx`, `src/lib/chat/` (sugestões e a régua que
  saiu), `src/lib/history-panel.ts` (nova), `messages/*.json`, os unitários do chat e do shell e os
  e2e `chat.spec.ts`, `shell.spec.ts`, `history.spec.ts` e `a11y.spec.ts`.
- Nada muda na API, no cliente gerado nem nos itens da lista do histórico.
