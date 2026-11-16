## ADDED Requirements

### Requirement: Fontes recolhidas numa linha

As fontes da resposta MUST ficar recolhidas numa linha com a contagem ("12 fontes"), um botão com
`aria-expanded` que abre uma lista de uma coluna em linhas finas, com o número, o dispositivo e a
situação da redação. A linha SHALL abrir o painel de citação como o chip, e a fonte aberta no painel
SHALL ficar marcada. Citação recusada pelo validador SHALL sair riscada, em tom apagado.

#### Scenario: Muitas fontes

- **WHEN** a resposta tem doze fontes
- **THEN** só a linha "12 fontes" fica à vista, e o clique nela abre a lista com as doze

#### Scenario: Fonte abre a citação

- **WHEN** o usuário abre a lista e clica na fonte 2
- **THEN** o painel mostra "Citação 2 de 2", e a fonte 2 fica marcada até o painel fechar

### Requirement: Abertura curta do chat vazio

Sem conversa, o chat MUST mostrar uma abertura curta: o selo, a saudação (o `h1` da página) e uma
linha sobre o que o Tekó responde. A data de referência SHALL aparecer uma vez só, no chip do
composer.

#### Scenario: Data num lugar só

- **WHEN** o usuário abre `/pt-BR/chat/?ref=2008-05` sem conversa
- **THEN** 05/2008 aparece só no chip do composer, e o clique nele abre o seletor da data

## MODIFIED Requirements

### Requirement: Composer num bloco só

O composer MUST ser um bloco só, com o mínimo à vista: a área de texto, o chip da data de referência
e o botão redondo de enviar (nome acessível "Enviar", com o atalho no `title` e no
`aria-keyshortcuts`), que vira "Parar" durante a resposta. O contador de caracteres SHALL aparecer
só perto do limite. Os avisos (cota, data fora da cobertura, data inferida, dados pessoais) SHALL
entrar no topo do bloco só quando acontecem.

#### Scenario: Enviar pelo botão

- **WHEN** o usuário digita a pergunta e aciona o botão "Enviar"
- **THEN** a pergunta sai com a data do chip, e o botão vira "Parar" até o fim da resposta

#### Scenario: Composer sem ruído

- **WHEN** o chat abre sem conversa numa data com cobertura
- **THEN** o composer não mostra linha de cobertura nem a dica do atalho, e o botão "Enviar" tem
  `title` "Enviar (Ctrl+Enter)"

### Requirement: Data usada visível e na URL

A data escolhida MUST ficar na URL (`ref`), junto com a conversa (`c`) e a última pergunta (`q`).
O cabeçalho de cada resposta SHALL repetir a data e a vigência usadas numa linha discreta, em texto
pequeno e apagado, com o ponto âmbar da data ("05/2008 · vigência desde 23/09/2005"); data inferida
do texto aparece marcada "inferida do texto", e o composer oferece "Confirmar" para fixá-la no chip.

#### Scenario: Data do texto

- **WHEN** a API resolve a data pelo texto da pergunta (`question_text`)
- **THEN** o cabeçalho marca a data como inferida e "Confirmar" grava `ref` na URL

### Requirement: Cobertura, degradação e cota visíveis

O composer MUST avisar quando nenhuma fonte cobre a data escolhida, sem bloquear o envio. A linha
de metadados da resposta SHALL mostrar a degradação que afeta a qualidade; "Resposta em cache" fica
só na dica da linha e para leitores de tela. A cobertura parcial SHALL virar uma nota de uma linha
com os nomes legíveis das famílias, e a recusa SHALL mostrar o motivo. `quota_exceeded` e
`service_paused` MUST desabilitar o composer até o reset e mostrar o horário dele.

#### Scenario: Cota estourada

- **WHEN** o `POST /questions` responde `quota_exceeded`
- **THEN** o composer fica desabilitado e mostra quando as perguntas voltam

#### Scenario: Cobertura parcial com nomes legíveis

- **WHEN** a resposta chega com `uncoveredFamilies: ['efd-icms-ipi']`
- **THEN** a nota diz "Sem fontes de EFD ICMS/IPI nesta data", sem o código `efd-icms-ipi`

#### Scenario: Degradação na linha de metadados

- **WHEN** a resposta chega com busca só lexical, modelo de reserva e do cache
- **THEN** a linha mostra "Somente busca lexical" e "Modelo de reserva", e "Resposta em cache" fica
  na dica da linha

### Requirement: Citações navegáveis

O link `cite:<id>` MUST virar um chip numerado com prévia no hover e no foco. O clique SHALL abrir
o painel de citação (ao lado da conversa no desktop, Drawer abaixo de 768 px) com documento, versão,
badge do intervalo de vigência, texto em `lang="pt-BR"`, a chave do dispositivo, link da fonte,
"copiar citação", "reportar", navegação por `[`/`]` e "Abrir o dispositivo". O painel SHALL
fechar pelo botão "Fechar a citação" e por `Esc`, devolvendo o foco ao chip.

#### Scenario: Chip de citação

- **WHEN** o usuário clica no chip 1 de uma resposta
- **THEN** o painel mostra a citação S1 com o intervalo de vigência, e `]` passa para a S2

#### Scenario: Fechar com Esc

- **WHEN** o painel está aberto no desktop e o usuário tecla `Esc` com o foco no chip
- **THEN** o painel fecha e o histórico volta ao lado da conversa

### Requirement: Sugestões do chat vazio

As sugestões MUST ser quatro linhas finas, todas diferentes, sem subtítulo de seção nem badges:
"O que diz o art. 76, § 6º do RCTE?" com um botão para 05/2008 e outro para 01/2010 (nomes
acessíveis "Perguntar em 05/2008" e "Perguntar em 01/2010"), e uma pergunta de cada outra família
do corpus (EFD ICMS/IPI, EFD-Reinf e EFD de Goiás) com o período em que será feita. Enviar uma
sugestão SHALL gravar o período em `ref` e levar o foco ao composer.

#### Scenario: Sugestões sem repetir

- **WHEN** o usuário abre `/pt-BR/chat/` sem conversa
- **THEN** vê quatro perguntas diferentes, a do DoD com "Perguntar em 05/2008" e "Perguntar em
  01/2010"

#### Scenario: Sugestão de família

- **WHEN** o usuário escolhe a sugestão do registro C170 da EFD ICMS/IPI
- **THEN** a pergunta vai com `periodo_apuracao` 2025-06 e o foco fica no composer

## REMOVED Requirements

### Requirement: Fontes em cartões

**Reason**: a grade de cartões de duas colunas competia com o texto da resposta; as fontes passam a
ficar recolhidas numa linha que abre uma lista de uma coluna.

**Migration**: substituída por "Fontes recolhidas numa linha"; o nome acessível de cada fonte
("Fonte n: dispositivo") e o atributo `data-source-id` continuam os mesmos.

### Requirement: Abertura do chat vazio

**Reason**: a data em destaque sobre a régua do corpus repetia o chip do composer; a abertura
passa a ter só o selo, a saudação e uma linha.

**Migration**: substituída por "Abertura curta do chat vazio"; a data fica só no chip do composer,
que abre o mesmo seletor (e o `Alt+D` continua). O atributo `data-welcome-date` deu lugar a
`data-chat-welcome`, na abertura inteira.
