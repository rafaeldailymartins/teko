## MODIFIED Requirements

### Requirement: Banner sem dark pattern

O banner MUST oferecer Aceitar, Recusar e Personalizar com a mesma variante e o mesmo tamanho. As
preferências SHALL listar os necessários como sempre ativos e as categorias opcionais (medição de
uso e pesquisas) desligadas por padrão, com Recusar tudo, Salvar escolhas e Aceitar tudo de mesmo
peso. Um link "Preferências de cookies" no rodapé do site e um item "Preferências de cookies" no
menu da conta do app shell MUST reabrir as preferências.

#### Scenario: Mesmo peso

- **WHEN** o banner aparece
- **THEN** os três botões têm a mesma classe e a mesma altura

#### Scenario: Reabrir pelo rodapé

- **WHEN** a pessoa que aceitou só a medição de uso clica em "Preferências de cookies" no rodapé
- **THEN** as preferências abrem com a medição ligada e as pesquisas desligadas, e "Recusar tudo"
  grava a recusa

#### Scenario: Reabrir pelo menu da conta

- **WHEN** a pessoa, no chat, abre o menu da conta e escolhe "Preferências de cookies"
- **THEN** as preferências de cookies abrem
