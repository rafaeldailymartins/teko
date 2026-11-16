# web-history Specification

## Purpose

Define as telas do web do Tekó sobre o que já foi perguntado e sobre o corpus: o histórico de
conversas, a página de dispositivo com a vigência, a linha do tempo e "O que mudou", a busca de
dispositivos e a comparação entre datas.

## Requirements

### Requirement: Histórico de conversas

O web MUST listar as conversas do usuário (`GET /api/v1/conversations`) no painel de histórico do
chat (num Sheet abaixo de 768 px) e na página `/[locale]/history/`, cada uma com o título, a data de
referência da última pergunta, a contagem e o instante da última pergunta. Abrir uma conversa SHALL
navegar para `/[locale]/chat/?c=<conversationId>` e fechar o Sheet; no painel, a conversa aberta
SHALL ficar marcada.

#### Scenario: Abrir uma conversa do histórico

- **WHEN** o usuário com uma conversa abre `/pt-BR/history/` e escolhe a conversa
- **THEN** o app vai para `/pt-BR/chat/?c=<conversationId>` e, no desktop, o painel de histórico a marca como aberta

### Requirement: Histórico por dia e com busca

O histórico MUST agrupar as conversas por dia no fuso de São Paulo (hoje, ontem, últimos 7 dias,
últimos 30 dias e anteriores), com a data de referência em mono. A partir de quatro conversas
carregadas, SHALL haver uma busca pelo título que ignora acento e caixa.

#### Scenario: Busca pelo título

- **WHEN** o usuário digita "credito efd" na busca do histórico
- **THEN** só ficam as conversas cujo título tem as duas palavras, como "Crédito de ICMS na EFD"

### Requirement: Estados e páginas do histórico

O painel de histórico MUST mostrar a primeira página e levar ao histórico completo quando houver
mais; a página `/[locale]/history/` SHALL carregar as seguintes sob demanda. Carregamento, lista
vazia e erro MUST ter estado próprio, com nova tentativa; sem sessão, o erro SHALL levar ao login.

#### Scenario: Sem sessão

- **WHEN** a lista responde 401 `unauthenticated`
- **THEN** o histórico mostra a mensagem de `errors.unauthenticated` e um link para `/[locale]/sign-in/`

#### Scenario: Mais conversas

- **WHEN** a primeira página traz `nextCursor` e o usuário escolhe "Carregar mais" na página de histórico
- **THEN** o web pede a lista com esse `cursor` e acrescenta as conversas abaixo das que já estavam

### Requirement: Página de dispositivo

A página `/[locale]/provision/?k=<stableKey>&ref=<data>` MUST mostrar a redação do dispositivo vigente
na data (`ref` ausente = hoje em São Paulo), com o texto em `lang="pt-BR"`, o ato, a tabela de campos
quando houver, o badge do intervalo de vigência (vigente, encerrada ou futura, com o último dia
incluído) e a linha do tempo das redações. Sem redação vigente na data, SHALL mostrar a anterior mais
próxima e avisar.

#### Scenario: Art. 76, § 6º do RCTE em 05/2008

- **WHEN** o usuário abre `/pt-BR/provision/?k=go:rcte:art:76:par:6&ref=2008-05`
- **THEN** a página mostra a redação vigente em 01/05/2008, com o badge e a linha do tempo

### Requirement: O que mudou e linha do tempo navegável

Na página de dispositivo, "O que mudou" em relação à redação anterior MUST ser pedido à API só quando
o usuário o abrir. Escolher uma redação na linha do tempo SHALL trocar a data da URL para o primeiro
dia dela e mostrar o texto dela.

#### Scenario: Diff sob demanda

- **WHEN** a página de dispositivo carrega
- **THEN** o diff só é pedido depois do clique em "O que mudou", e as inserções e remoções aparecem marcadas

#### Scenario: Escolha na linha do tempo

- **WHEN** o usuário escolhe a última redação na linha do tempo
- **THEN** a URL passa a `ref=<primeiro dia da redação>` e o texto mostrado é o dela

### Requirement: Busca de dispositivos

Sem `k`, a página de dispositivo MUST oferecer a busca de dispositivos vigentes na data
(`GET /api/v1/provisions?q=&at=`), a partir de 2 caracteres, com os resultados levando à página de
cada dispositivo na mesma data.

#### Scenario: Busca pelo rótulo

- **WHEN** o usuário digita "art. 76" em `/pt-BR/provision/?ref=2008-05`
- **THEN** os resultados vigentes em 01/05/2008 aparecem, cada um com link para `?k=<stableKey>&ref=2008-05-01`

### Requirement: Comparação entre datas

A página `/[locale]/compare/?k=<stableKey>&from=<data>&to=<data>` MUST mostrar as redações vigentes
em cada data e o diff entre elas (inserções em verde-folha, remoções riscadas e os campos
alterados), lado a lado no desktop e empilhados no celular, com um formulário que valida a chave e
exige `from` anterior a `to` antes de escrever a URL, o exemplo do roteiro (RCTE, art. 76, § 6º,
05/2008 contra 01/2010) e um estado vazio sem comparação na URL.

#### Scenario: Exemplo do roteiro

- **WHEN** o usuário abre `/pt-BR/compare/?k=go:rcte:art:76:par:6&from=2008-05&to=2010-01`
- **THEN** a página mostra as redações de 01/05/2008 e de 01/01/2010 e os trechos incluídos e removidos

#### Scenario: Datas invertidas

- **WHEN** o usuário envia o formulário com a data final antes da inicial
- **THEN** o formulário avisa o erro e a URL não muda

### Requirement: Excluir uma conversa

Cada conversa do histórico, no painel do chat e na página `/[locale]/history/`, MUST ter um menu "⋯"
com "Excluir conversa", visível no hover e no foco da linha e sempre visível no toque. A ação SHALL
pedir confirmação num diálogo de alerta com o título da conversa, o aviso de que não dá para desfazer e
um botão destrutivo; cancelar MUST devolver o foco ao "⋯".

#### Scenario: Excluir pela lista

- **WHEN** o usuário abre o "⋯" de uma conversa em `/pt-BR/history/`, escolhe "Excluir conversa" e confirma
- **THEN** a conversa some da lista e o aviso "Conversa excluída." aparece

#### Scenario: Cancelar

- **WHEN** o usuário abre a confirmação e escolhe "Cancelar"
- **THEN** nada é apagado, e o foco volta ao "⋯" da conversa

### Requirement: Depois da exclusão

Excluída a conversa, o foco SHALL ir para a conversa vizinha e um aviso discreto (`aria-live`) MUST
confirmar. Se a conversa excluída era a aberta (`?c=`), o app MUST voltar ao chat vazio com a mesma
data de referência, sem deixar a conversa excluída no histórico do navegador. Uma resposta ainda em
andamento na conversa SHALL dar uma mensagem própria no diálogo.

#### Scenario: Excluir a conversa aberta

- **WHEN** o usuário está em `/pt-BR/chat/?c=<id>&ref=2008-05` e exclui essa conversa pelo painel de histórico
- **THEN** o app vai para `/pt-BR/chat/?ref=2008-05`, com o chat vazio

#### Scenario: Resposta em andamento

- **WHEN** a exclusão responde 409 `stream_busy`
- **THEN** o diálogo continua aberto, explica que a resposta ainda está sendo gerada e a conversa fica na lista
