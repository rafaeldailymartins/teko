## ADDED Requirements

### Requirement: Raiz por idioma em desenvolvimento

Em `next dev`, o `next.config.ts` MUST redirecionar `/` com a mesma regra das rotas de produção:
`/en/` quando o primeiro idioma do `Accept-Language` é inglês e `/pt-BR/` nos demais casos. Um teste
SHALL conferir que a expressão do web é a do `policy.ts` da API.

#### Scenario: Raiz em desenvolvimento

- **WHEN** `next dev` recebe `/` com `Accept-Language: en-US,en;q=0.9`
- **THEN** responde um redirect temporário para `/en/`

### Requirement: Entrada estática sem escolha de idioma

A página estática de `/` SHALL NOT mostrar escolha de idioma: é uma tela neutra com a logo que vai
na hora para o idioma do navegador, pela mesma regra do `Accept-Language`. O redirect para o locale
padrão e os links dos dois idiomas MUST ficar só no `<noscript>`.

#### Scenario: Entrada estática em outro servidor

- **WHEN** um servidor estático sem as rotas de produção serve `/index.html` a um navegador em inglês
- **THEN** o navegador vai para `/en/` sem mostrar texto de escolha de idioma

#### Scenario: Entrada sem JavaScript

- **WHEN** a entrada `/` abre com o JavaScript desligado
- **THEN** o `<meta refresh>` leva a `/pt-BR/`, e os links dos dois idiomas aparecem
