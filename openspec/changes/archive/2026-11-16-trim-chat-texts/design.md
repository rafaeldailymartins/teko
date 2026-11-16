# Design

## Context

Corte de texto pedido pelo mantenedor; nenhum comportamento muda além do que aparece na tela.
Nenhuma biblioteca nova nem uso novo de API de biblioteca (sem consulta ao Context7).

## Decisions

- **`EmptyState` com a frase opcional.** Sem `children`, o componente não renderiza o parágrafo vazio.
- **`isDefault` sai de `referenceDisplay`.** Só a dica do chip o usava; a escolha nula continua
  resolvendo para o período default.
- **A cota segue nos termos.** A privacidade e os termos continuam dizendo que excluir não devolve
  perguntas; só o diálogo deixa de repetir.
