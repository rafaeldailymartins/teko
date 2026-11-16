# web-consent Specification

## Purpose

Define o consentimento LGPD no navegador (banner, preferências por categoria e escolha versionada) e
o adapter que é o único caminho até o SDK de analytics, carregado só depois do consentimento.

## Requirements

### Requirement: Nada gravado antes do consentimento

Antes da escolha de consentimento, o web MUST NOT gravar cookies nem chaves do PostHog
(`ph_*`, `__ph_*`, `posthog*`) em `localStorage` ou `sessionStorage`, nem fazer pedidos a hosts do
PostHog. A própria escolha SHALL ser gravada só depois da decisão.

#### Scenario: Primeira visita

- **WHEN** alguém abre `/pt-BR/` sem estado no navegador
- **THEN** o banner aparece, `context.cookies()` é vazio, o `localStorage` está vazio e nenhum pedido
  vai ao PostHog

#### Scenario: Recusa

- **WHEN** a pessoa clica em Recusar e recarrega a página
- **THEN** o banner não volta, só `teko-consent` existe no `localStorage` (com `analytics: false`) e
  continua sem cookies

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

### Requirement: Escolha versionada

A escolha MUST ficar em `localStorage['teko-consent']` com a versão da política de privacidade
(`PRIVACY_POLICY_VERSION`), o momento e as categorias. Valor de outra versão, malformado ou com
categoria faltando SHALL valer como "sem escolha". Com o storage bloqueado, a escolha MUST valer
para a página atual sem o banner voltar.

#### Scenario: Política nova

- **WHEN** a escolha gravada tem uma versão da política diferente da vigente
- **THEN** o banner volta a aparecer

### Requirement: Adapter único de analytics

O SDK de analytics MUST ser carregado só pelo adapter de `src/lib/analytics`, por `import()`, depois
do consentimento `analytics: true` e com a chave pública `NEXT_PUBLIC_POSTHOG_KEY` presente no build.
Sem a chave, nada SHALL carregar nem com aceite. Retirar o consentimento MUST desligar o cliente
carregado e limpar o navegador, e um carregamento que termine depois de uma recusa SHALL NOT ativar o cliente. O lint MUST barrar
`posthog-js` fora de `src/lib/analytics/**`.

#### Scenario: Aceite sem chave

- **WHEN** a pessoa aceita tudo num build sem `NEXT_PUBLIC_POSTHOG_KEY`
- **THEN** a escolha é gravada e o carregador não é chamado

#### Scenario: Recusa durante o carregamento

- **WHEN** a pessoa aceita e recusa antes de o cliente terminar de carregar
- **THEN** o cliente que chega é desligado e nenhum evento é enviado

#### Scenario: Import fora do adapter

- **WHEN** um componente em `src/components` importa `posthog-js`
- **THEN** o Biome reprova com `noRestrictedImports`

#### Scenario: Consentimento retirado

- **WHEN** a pessoa retira a medição com o cliente carregado
- **THEN** o cliente faz o opt-out e o `localStorage` fica sem chaves do PostHog
