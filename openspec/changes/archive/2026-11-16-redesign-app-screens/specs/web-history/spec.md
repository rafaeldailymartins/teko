## ADDED Requirements

### Requirement: Histórico por dia e com busca

O histórico MUST agrupar as conversas por dia no fuso de São Paulo (hoje, ontem, últimos 7 dias,
últimos 30 dias e anteriores), com a data de referência em mono. A partir de quatro conversas
carregadas, SHALL haver uma busca pelo título que ignora acento e caixa.

#### Scenario: Busca pelo título

- **WHEN** o usuário digita "credito efd" na busca do histórico
- **THEN** só ficam as conversas cujo título tem as duas palavras, como "Crédito de ICMS na EFD"

## MODIFIED Requirements

### Requirement: Histórico de conversas

O web MUST listar as conversas do usuário (`GET /api/v1/conversations`) no painel de histórico do
chat (num Sheet abaixo de 768 px) e na página `/[locale]/history/`, cada uma com o título, a data de
referência da última pergunta, a contagem e o instante da última pergunta. Abrir uma conversa SHALL
navegar para `/[locale]/chat/?c=<conversationId>` e fechar o Sheet; no painel, a conversa aberta
SHALL ficar marcada.

#### Scenario: Abrir uma conversa do histórico

- **WHEN** o usuário com uma conversa abre `/pt-BR/history/` e escolhe a conversa
- **THEN** o app vai para `/pt-BR/chat/?c=<conversationId>` e, no desktop, o painel de histórico a marca como aberta

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
