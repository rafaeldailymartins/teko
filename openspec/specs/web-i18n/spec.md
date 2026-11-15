# web-i18n Specification

## Purpose

Define os idiomas do `apps/web` (paridade dos catálogos pt-BR e en, formatação de datas e trechos
em português na UI em inglês) e as páginas legais e "Sobre".

## Requirements

### Requirement: Paridade dos catálogos

Os catálogos `messages/pt-BR.json` e `messages/en.json` MUST ter exatamente as mesmas chaves em
todos os namespaces, com os mesmos argumentos ICU e as mesmas tags de rich text em cada mensagem, e
toda mensagem SHALL ser texto não vazio. O teste de paridade MUST apontar a chave que falta e a que
sobra no inglês.

#### Scenario: Chave faltando no inglês

- **WHEN** alguém cria `consent.preferences.title` só no pt-BR
- **THEN** o `test:unit` do web falha com `consent.preferences.title` em `missing`

#### Scenario: Chave sobrando no inglês

- **WHEN** o en ganha um namespace `about.extra` que o pt-BR não tem
- **THEN** o teste falha com `about.extra.*` em `extra`

#### Scenario: Tag de rich text divergente

- **WHEN** uma mensagem do pt-BR usa `<settings>` e a mesma chave no en não usa
- **THEN** o teste de paridade falha apontando a chave

### Requirement: Formatação de datas por locale

O web MUST formatar datas pelo helper de `src/lib/i18n`: data de calendário (`AAAA-MM-DD`) sem
deslocamento de fuso, instante no fuso de exibição `America/Sao_Paulo` (o mesmo `timeZone` do
next-intl) e período de apuração como `MM/AAAA` em qualquer idioma ou por extenso no idioma da UI.

#### Scenario: Data de calendário

- **WHEN** a versão `2010-01-01` é formatada em pt-BR
- **THEN** o texto é "1 de janeiro de 2010", nunca 31 de dezembro

#### Scenario: Instante

- **WHEN** o instante `2026-11-15T02:30:00Z` é formatado
- **THEN** aparece 14 de novembro, 23:30 (horário de São Paulo)

#### Scenario: Período de apuração

- **WHEN** o período `2024-03` é formatado por extenso
- **THEN** o pt-BR mostra "março de 2024" e o en "March 2024"; a forma numérica é "03/2024" nos dois

### Requirement: Páginas legais e Sobre

`/privacy`, `/terms` e `/about` MUST existir em pt-BR e en com conteúdo real, texto em Source Serif e
um sumário com âncoras para cada seção, sem violação de CSP aplicada.

#### Scenario: Sumário

- **WHEN** o usuário clica no último item do sumário de `/pt-BR/privacy/`
- **THEN** a URL ganha a âncora da seção e a seção com o mesmo título fica visível

### Requirement: Política de privacidade coerente com o registro de tratamento

A política de privacidade MUST seguir o `docs/privacy/ropa.md`: dados e bases legais da LGPD,
retenção de 90 dias das perguntas, operadores com o aviso de treino do provedor gratuito, exportação
e exclusão em `/settings` e contato pelo repositório, sem nome de pessoa, CNPJ ou endereço.

#### Scenario: Retenção e direitos

- **WHEN** alguém lê `/pt-BR/privacy/` ou `/en/privacy/`
- **THEN** a página cita a retenção de 90 dias e leva a `/settings` para exportar e apagar os dados

### Requirement: Termos com a versão exigida pela API

Os termos de uso MUST dizer que o Tekó é apoio à consulta e não constitui parecer, exigir 18+ e
exibir a versão em vigor, que SHALL ser a constante `TERMS_VERSION` de `@teko/shared/legal`, a mesma
que a API usa como padrão no onboarding.

#### Scenario: Versão dos Termos

- **WHEN** alguém abre `/en/terms/`
- **THEN** a página mostra a versão igual ao `TERMS_VERSION` de `@teko/shared/legal`

### Requirement: Trechos em português na UI em inglês

Nome de lei, de órgão ou trecho legal em português MUST ser marcado com `lang="pt-BR"` também nas
páginas em inglês.

#### Scenario: Nome da lei na política em inglês

- **WHEN** alguém abre `/en/privacy/`
- **THEN** "Lei Geral de Proteção de Dados Pessoais" está num elemento com `lang="pt-BR"`, dentro de
  um documento com `lang="en"`

### Requirement: Texto longo fora das mensagens do cliente

Os namespaces `legal` e `about` MUST ser renderizados só no servidor e SHALL NOT ir nas mensagens
que o `NextIntlClientProvider` serializa em cada página.

#### Scenario: Landing sem texto legal

- **WHEN** o build gera `/pt-BR/index.html`
- **THEN** o HTML não contém o texto das seções da política de privacidade
