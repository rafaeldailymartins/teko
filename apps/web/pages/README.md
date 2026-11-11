# pages/ (vazio de propósito)

Esta pasta existe só para que o Next.js **não** trate `src/pages` (a camada _pages_ do
Feature-Sliced Design) como Pages Router. Com `app/` e `pages/` na raiz de `apps/web`, o Next
ignora `src/app` e `src/pages`, que ficam livres para as camadas do FSD.

Não adicione arquivos aqui: as rotas ficam em `app/` (App Router) e só reexportam as páginas de
`src/pages/*`.
