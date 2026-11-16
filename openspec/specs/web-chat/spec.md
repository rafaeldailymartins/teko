# web-chat Specification

## Purpose

Define a experiência do chat no `apps/web`: o transporte do `useChat` na mesma origem, a thread e o
composer, a data de referência, a cobertura, a degradação, o markdown seguro e as citações, com o
código do chat fora do primeiro carregamento.

## Requirements

### Requirement: Transporte do chat na mesma origem

O chat MUST usar `useChat` com o `TekoChatTransport`: a pergunta sai por `POST /api/v1/questions`
pelo cliente gerado; `answered`, `refused` e `needs_clarification` SHALL virar chunks do UI Message
Stream sintetizados no cliente; `accepted` SHALL abrir `POST /api/v1/questions/:id/stream` na mesma
origem, com o cookie de sessão e o `abortSignal` do `useChat`, e ler os chunks com o parser e o
schema do pacote `ai`. Falha antes do stream SHALL chegar à UI como `ApiError`.

#### Scenario: Resposta em cache

- **WHEN** a API responde `answered` ao `POST /questions`
- **THEN** a resposta aparece com data, citações e texto, sem abrir o stream

#### Scenario: Stream ocupado

- **WHEN** o stream da pergunta responde 409 `stream_busy`
- **THEN** a UI mostra `errors.stream_busy` e oferece tentar de novo

### Requirement: Releitura em vez de resume

O transporte MUST não retomar streams: `reconnectToStream` devolve `null`. A UI SHALL reler
`GET /api/v1/questions/:id` ao abrir uma pergunta da URL (`q`) e quando o usuário pede para
recarregar uma resposta interrompida.

#### Scenario: Stream caiu

- **WHEN** o stream termina num chunk `error` e a API grava a resposta depois
- **THEN** "Recarregar a resposta" relê a pergunta e mostra a resposta gravada

### Requirement: Chamadas à API só na camada de dados

O código do `apps/web` MUST chamar `fetch` só em `src/lib/api/**`. O Biome SHALL reprovar `fetch(`
em qualquer outro arquivo do app, e um teste SHALL confirmar a regra com uma sonda barrada e outra
liberada.

#### Scenario: fetch num componente

- **WHEN** um componente em `src/components` chama `fetch('/api/v1/coverage')`
- **THEN** o lint falha com `lint/style/noRestrictedGlobals`

### Requirement: Thread e composer acessíveis

A conversa MUST mostrar a pergunta na hora do envio (bolha otimista), marcar a resposta em
andamento com `aria-busy` e anunciar o início e o fim de cada resposta numa região
`aria-live="polite"`. O composer SHALL enviar com `Ctrl/⌘+Enter`, receber o foco com `/` e parar
o stream com `Esc` ou com o botão "Parar". Cada mensagem SHALL ficar num `ErrorBoundary` próprio.

#### Scenario: Parar a resposta

- **WHEN** a resposta está em stream e o usuário tecla `Esc`
- **THEN** o stream é abortado, o botão volta a "Enviar" e a região viva anuncia a interrupção

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

### Requirement: Aviso de PII antes de enviar

Antes de enviar, o detector de PII do composer (as regras de `@teko/shared/pii`) MUST avisar quando
a pergunta tiver CPF, CNPJ, chave de acesso, e-mail ou telefone, e SHALL oferecer trocar os dados
pelos marcadores ou enviar assim mesmo.

#### Scenario: CPF na pergunta

- **WHEN** o usuário tenta enviar uma pergunta com um CPF válido
- **THEN** o composer mostra o aviso de dados pessoais e não envia até ele remover os dados ou
  confirmar o envio

### Requirement: Data de referência explícita

O composer MUST mostrar um chip fixo com a data de referência ("Período de apuração: 03/2024"), com
month picker, alternância para data exata, atalhos (mês anterior, mês atual, último período fechado)
e `Alt+D`. Enquanto o usuário não mexe no chip, a pergunta SHALL ir com `source: 'default'`; período
escolhido vai como `periodo_apuracao`, data exata como `explicit`, e a escolha de um
`needs_clarification` como `clarified`.

#### Scenario: A mesma pergunta em duas datas

- **WHEN** o usuário pergunta "O que diz o art. 76, § 6º do RCTE?" em 05/2008 e depois em 01/2010
- **THEN** as duas respostas mostram datas, citações e intervalos de vigência diferentes

#### Scenario: Esclarecimento

- **WHEN** a API responde `needs_clarification` com duas datas candidatas
- **THEN** a UI mostra um botão por data, e a escolhida reenvia a pergunta com `source: 'clarified'`

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

### Requirement: Markdown seguro

A resposta MUST ser renderizada com Streamdown, sem HTML cru como elemento, sem imagens e com links
só para a própria origem e para `https://sped.rfb.gov.br`, `https://www.gov.br` e
`https://appasp.economia.go.gov.br`. Nada do markdown pode exigir `eval`, WASM ou `<style>` em
runtime (a CSP barra).

#### Scenario: Link fora da lista

- **WHEN** a resposta traz um link para um domínio fora da lista
- **THEN** o texto do link aparece sem `<a>`

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

### Requirement: Linha do tempo e O que mudou no painel de citação

O painel de citação MUST mostrar a linha do tempo do dispositivo citado (`ProvisionTimeline`), com a
redação vigente na data de referência da resposta marcada. "O que mudou" (`ProvisionDiff`) SHALL
comparar essa redação com a anterior e MUST ter o código e a consulta à API só depois do clique.

#### Scenario: Linha do tempo no painel

- **WHEN** o usuário abre a citação do RCTE, art. 76, § 6º numa resposta de 05/2008
- **THEN** o painel lista as redações do § 6º com a de 04/11/2004 a 22/11/2009 marcada, sem pedir o diff

#### Scenario: O que mudou no painel

- **WHEN** o usuário clica em "Ver o que mudou em relação à redação anterior"
- **THEN** o painel pede o diff da redação anterior contra a vigente em 01/05/2008 e marca inserções e remoções

### Requirement: Chat fora do primeiro carregamento

O código da conversa (AI SDK, Streamdown, realce de código) e o painel de citação MUST carregar sob
demanda, só no `/chat/`, fora da soma de first-load conferida pelo orçamento de bundle.

#### Scenario: Orçamento

- **WHEN** o pós-build soma o JS gz do primeiro acesso
- **THEN** nenhum chunk do Streamdown, do Shiki ou do `useChat` entra na conta

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

### Requirement: Conversa aberta pela URL

Abrir o chat com `c=<conversationId>` MUST reler as perguntas da conversa
(`GET /api/v1/questions?conversationId=`) e mostrar todas, em ordem; quando o `c` muda por fora da
conversa em andamento (histórico, botão voltar), o chat SHALL trocar de conversa e fechar a citação
aberta. "Nova conversa", no painel de histórico, MUST levar ao chat vazio mantendo a data escolhida.

#### Scenario: Conversa do histórico

- **WHEN** o usuário abre uma conversa com duas perguntas pelo histórico
- **THEN** o chat mostra as duas perguntas e as duas respostas, sem a abertura

### Requirement: Rolagem que respeita a leitura

Durante o stream, a conversa MUST descer junto com a resposta só enquanto o usuário estiver no fim;
se ele subir para reler, ela SHALL ficar parada e oferecer "Ir para o fim da conversa". Sem
conversa, nada rola.

#### Scenario: Releitura durante o stream

- **WHEN** a resposta está em stream e o usuário rola para cima
- **THEN** a posição não muda a cada pedaço, e o botão "Ir para o fim da conversa" aparece

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
