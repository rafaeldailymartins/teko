# web-coverage Specification

## Purpose

Define a página pública do web do Tekó que diz o que o corpus cobre: as famílias por jurisdição, as
fontes, os períodos cobertos, as lacunas e a última verificação, a partir de `GET /api/v1/coverage`.

## Requirements

### Requirement: Página pública de cobertura

A página `/[locale]/coverage/` MUST mostrar, sem sessão e fora do grupo `(app)`, as famílias da
cobertura efetiva de `GET /api/v1/coverage`, agrupadas por jurisdição (federal antes de Goiás), cada
uma com o nome e as fontes do catálogo (o slug, para família desconhecida). O título e a introdução
MUST estar no HTML estático.

#### Scenario: Sem sessão, nos dois idiomas

- **WHEN** um visitante sem cookie abre `/pt-BR/coverage/` ou `/en/coverage/`
- **THEN** a página não leva à entrada, mostra as famílias da API e não registra violação de CSP aplicada

### Requirement: Períodos, lacunas e verificação por família

Cada família MUST mostrar os períodos cobertos, as lacunas entre eles e a data da última
verificação; a página SHALL mostrar também a verificação mais recente e a versão do corpus. Os
períodos SHALL mostrar o último dia incluído, com datas de calendário sem deslocamento de fuso.

#### Scenario: Lacuna entre períodos

- **WHEN** uma família cobre `[1998-01-01, 2004-01-01)` e `[2005-01-01, 2026-11-11)`
- **THEN** a lacuna aparece como "01/01/2004 a 31/12/2004" na cor `--coverage-out`

### Requirement: Estados da página de cobertura

A página de cobertura MUST ter estado de carregamento, de erro e de vazio. O erro SHALL mostrar
`t(error.messageKey)` e, quando o erro for repetível, um botão que relê a cobertura; sem famílias, um
estado vazio com texto do catálogo.

#### Scenario: Erro repetível

- **WHEN** a cobertura responde 429 `rate_limited` e o usuário clica em "Tentar de novo"
- **THEN** a página pede a cobertura de novo e mostra as famílias

### Requirement: Barra da cobertura acessível

Cada família MUST ter uma barra proporcional da cobertura numa escala comum a todas (do começo mais
antigo ao dia seguinte à última verificação), com os trechos cobertos em `--validity-current` e as
lacunas em `--coverage-out`, posicionados por atributo `style` (nenhum `<style>` em runtime). A barra
SHALL ser `aria-hidden`, com legenda e escala em texto, porque a lista diz o mesmo.

#### Scenario: Família sem cobertura

- **WHEN** uma família vem com `covered` vazio
- **THEN** ela aparece com "Ainda sem cobertura" e sem barra
