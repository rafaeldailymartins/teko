# Spec Delta

## MODIFIED Requirements

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
