# web-landing Specification

## Purpose

Define a landing do web do Tekó (o hero com a linha do tempo da marca, a demonstração animada do
chat e as seções) e a apresentação das páginas públicas de texto longo, sem chamar a API.

## Requirements

### Requirement: Hero com a linha do tempo da marca

O hero da landing MUST ter a manchete em serif, a chamada principal "Abrir o Tekó" no botão `brand`
(para o chat do locale) e uma secundária para a cobertura, e SHALL mostrar a linha do tempo do
dispositivo da demonstração (as redações, a revogação e o ponto âmbar da data de referência), que
acompanha a data da cena. A linha do tempo é decorativa (`aria-hidden`).

#### Scenario: Chamada principal

- **WHEN** um visitante abre `/pt-BR/`
- **THEN** o hero tem o link "Abrir o Tekó" para `/pt-BR/chat/` e o link para `/pt-BR/coverage/`

### Requirement: Demonstração animada do chat

A landing MUST mostrar uma demonstração do chat que se anima sozinha, sem chamar a API, com um caso
real do corpus (RCTE, art. 76, § 6º): a pergunta digitada caractere a caractere, o chip da data de
referência (05/2008), a resposta em stream com o cabeçalho de data e vigência, a citação numerada e
o intervalo de vigência em verde-folha; depois a mesma pergunta em 01/2010, com a redação e o
intervalo mudando. As datas SHALL ser as da fixture do corpus, conferidas por teste.

#### Scenario: Animação em loop

- **WHEN** a landing abre na tela, com movimento liberado
- **THEN** depois do quadro inicial a conversa recomeça, a pergunta é digitada, o chip 05/2008
  aparece e a resposta chega em stream, sem nenhuma requisição a `/api/`

### Requirement: Controle e acessibilidade da demonstração

A demonstração MUST ficar parada fora da tela e com a aba oculta, e MUST ter um botão de pausa
(WCAG 2.2.2). A animação MUST ser `aria-hidden`, sem elementos focáveis, com um resumo textual para
leitor de tela; SHALL NOT usar `eval` nem injetar `<style>`, e o código do animador SHALL ficar fora
do JavaScript do primeiro acesso.

#### Scenario: Resumo acessível

- **WHEN** um leitor de tela chega à demonstração
- **THEN** ele lê o resumo com as duas datas e a revogação, e a janela animada fica fora da árvore
  acessível

#### Scenario: Pausa

- **WHEN** o visitante clica em "Pausar a demonstração"
- **THEN** a janela de chat para no quadro atual até ele clicar em "Retomar a demonstração"

#### Scenario: Fora da tela

- **WHEN** a demonstração sai da tela ou a aba fica oculta
- **THEN** o roteiro para e só volta a andar quando ela reaparece

### Requirement: Movimento reduzido e HTML estático na demonstração

Com `prefers-reduced-motion: reduce`, a demonstração MUST mostrar o estado final (as duas respostas
completas, com a segunda data), sem digitação e sem o botão de pausa. O HTML estático SHALL ter esse
mesmo quadro final, legível sem JavaScript.

#### Scenario: Movimento reduzido

- **WHEN** a landing abre com `prefers-reduced-motion: reduce`
- **THEN** a demonstração mostra as duas respostas completas e a data 01/2010, e não muda depois de
  alguns segundos

### Requirement: Seções da landing com ritmo próprio

A landing MUST ter, depois do hero: "Como funciona" como uma linha do tempo de três passos (data,
citação e cobertura, cada um com uma amostra do chat); o corpus coberto com ícone, jurisdição e uma
régua de períodos por família, com o link para a cobertura exata; as garantias; o FAQ em acordeão de
`<details>`, um aberto por vez; e uma faixa final de chamada no gradiente da marca.

#### Scenario: FAQ em acordeão

- **WHEN** o visitante abre uma pergunta do FAQ e depois outra
- **THEN** a segunda resposta aparece e a primeira se fecha

### Requirement: Páginas de texto longo em tipografia editorial

As páginas de privacidade, termos e sobre MUST ter um cabeçalho com sobretítulo, o título em serif
e, nas legais, a versão; o sumário com âncoras SHALL ficar fixo ao lado do texto no desktop e antes
do texto no celular, e cada seção SHALL ter a sua marca (`§ n` nos textos legais). A apresentação
MUST NOT mudar o texto do catálogo.

#### Scenario: Sumário fixo

- **WHEN** alguém rola `/pt-BR/privacy/` até a última seção num viewport de desktop
- **THEN** o sumário continua visível ao lado do texto
