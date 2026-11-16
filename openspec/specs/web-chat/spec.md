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
`aria-live="polite"`. O composer SHALL enviar com `Ctrl/⌘+Enter`, receber o foco com `/` e parar o
stream com `Esc` ou com o botão "Parar". Cada mensagem SHALL ficar num `ErrorBoundary` próprio.

#### Scenario: Parar a resposta

- **WHEN** a resposta está em stream e o usuário tecla `Esc`
- **THEN** o stream é abortado, o botão volta a "Enviar" e a região viva anuncia a interrupção

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
O cabeçalho de cada resposta SHALL repetir a data e a vigência usadas; data inferida do texto
aparece em âmbar, e o composer oferece "Confirmar" para fixá-la no chip.

#### Scenario: Data do texto

- **WHEN** a API resolve a data pelo texto da pergunta (`question_text`)
- **THEN** o cabeçalho marca a data como inferida e "Confirmar" grava `ref` na URL

### Requirement: Cobertura, degradação e cota visíveis

O composer MUST indicar a cobertura do corpus na data escolhida (fundamentada, parcial ou fora de
cobertura) sem bloquear o envio. A resposta SHALL mostrar os rótulos de degradação de `data-meta`
("Somente busca lexical", "Modelo de reserva", "Resposta em cache"), o aviso de cobertura parcial e,
na recusa, o motivo. `quota_exceeded` e `service_paused` MUST desabilitar o composer até o reset e
mostrar o horário dele.

#### Scenario: Cota estourada

- **WHEN** o `POST /questions` responde `quota_exceeded`
- **THEN** o composer fica desabilitado e mostra quando as perguntas voltam

### Requirement: Markdown seguro

A resposta MUST ser renderizada com Streamdown, sem HTML cru como elemento, sem imagens e com links
só para a própria origem e para `https://sped.rfb.gov.br`, `https://www.gov.br` e
`https://appasp.economia.go.gov.br`. Nada do markdown pode exigir `eval`, WASM ou `<style>` em
runtime (a CSP barra).

#### Scenario: Link fora da lista

- **WHEN** a resposta traz um link para um domínio fora da lista
- **THEN** o texto do link aparece sem `<a>`

### Requirement: Citações navegáveis

O link `cite:<id>` MUST virar um chip numerado com prévia no hover. O clique SHALL abrir o painel de
citação (Drawer abaixo de 768 px) com documento, versão, badge do intervalo de vigência, texto em
`lang="pt-BR"`, campos, link da fonte, "copiar citação", "reportar", navegação por `[`/`]` e o link
"Abrir o dispositivo" para a página do dispositivo.

#### Scenario: Chip de citação

- **WHEN** o usuário clica no chip 1 de uma resposta
- **THEN** o painel mostra a citação S1 com o intervalo de vigência, e `]` passa para a S2

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
