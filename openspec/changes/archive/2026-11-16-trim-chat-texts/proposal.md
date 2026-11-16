# Proposal

## Why

O mantenedor pediu menos texto nas telas do chat e do histórico. Três frases sobravam: a explicação
do histórico vazio ("Suas conversas aparecem aqui…"), o aviso de cota no diálogo de exclusão e o
"(padrão: mês anterior)" ao lado da data no chip do composer.

## What Changes

- **Histórico vazio só com o título.** Na página, o estado vazio fica com o ícone e "Nenhuma conversa
  ainda"; no painel do chat, a mesma frase curta.
- **Diálogo de exclusão sem o aviso de cota.** Ficam o título da conversa, o aviso de que não dá para
  desfazer e o botão destrutivo. A regra não muda: excluir continua sem devolver perguntas à cota.
- **Chip da data sem a dica do default.** O chip mostra só o período ou a data.

## Capabilities

### Modified Capabilities

- `web-history`: o diálogo de excluir uma conversa deixa de avisar sobre a cota.

## Impact

- `apps/web`: `messages/*.json`, `components/empty-state.tsx`, `components/history/` (lista e
  exclusão), `components/chat/reference-picker.tsx`, `lib/chat/reference.ts` e os unitários deles.
- Nada muda na API nem nos e2e.
