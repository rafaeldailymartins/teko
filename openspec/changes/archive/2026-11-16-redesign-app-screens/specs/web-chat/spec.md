## ADDED Requirements

### Requirement: Abertura do chat vazio

Sem conversa, o chat MUST mostrar uma abertura com a saudação (o `h1` da página), o que o Tekó
responde e a data de referência em destaque sobre a linha do tempo do corpus. A data em destaque
SHALL abrir o mesmo seletor do chip do composer.

#### Scenario: Data em destaque

- **WHEN** o usuário abre `/pt-BR/chat/?ref=2008-05` sem conversa
- **THEN** a abertura mostra 05/2008 sobre a linha do tempo, e o clique abre o seletor da data

### Requirement: Sugestões do chat vazio

As sugestões MUST ser todas diferentes: em destaque, "O que diz o art. 76, § 6º do RCTE?" com um
botão para 05/2008 e outro para 01/2010, e uma pergunta de cada família do corpus (EFD ICMS/IPI,
EFD-Reinf, RCTE e EFD de Goiás), com o ícone da família e o período em que será feita. Enviar uma
sugestão SHALL gravar o período em `ref` e levar o foco ao composer.

#### Scenario: Sugestões sem repetir

- **WHEN** o usuário abre `/pt-BR/chat/` sem conversa
- **THEN** vê cinco perguntas diferentes, a do DoD com "Perguntar em 05/2008" e "Perguntar em 01/2010"

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

### Requirement: Composer num bloco só

O composer MUST ser um bloco só, com a área de texto, o chip da data de referência, o indicador de
cobertura, o contador de caracteres, o atalho visível e o botão redondo de enviar (nome acessível
"Enviar"), que vira "Parar" durante a resposta. Os avisos (cota, cobertura, data inferida, dados
pessoais) SHALL entrar no topo do bloco.

#### Scenario: Enviar pelo botão

- **WHEN** o usuário digita a pergunta e aciona o botão "Enviar"
- **THEN** a pergunta sai com a data do chip, e o botão vira "Parar" até o fim da resposta

### Requirement: Fontes em cartões

As fontes da resposta MUST aparecer em cartões com o número, o dispositivo, o documento e a situação
da redação, as quatro primeiras à vista e as outras atrás de um botão; a fonte aberta no painel
SHALL ficar sempre à vista. O cartão SHALL abrir o painel de citação como o chip.

#### Scenario: Muitas fontes

- **WHEN** a resposta tem doze fontes
- **THEN** quatro cartões ficam à vista e "Mostrar 8 fontes a mais" abre o resto

## MODIFIED Requirements

### Requirement: Thread e composer acessíveis

A conversa MUST mostrar a pergunta na hora do envio (bolha otimista), marcar a resposta em
andamento com `aria-busy` e anunciar o início e o fim de cada resposta numa região
`aria-live="polite"`. O composer SHALL enviar com `Ctrl/⌘+Enter`, receber o foco com `/` e parar
o stream com `Esc` ou com o botão "Parar". Cada mensagem SHALL ficar num `ErrorBoundary` próprio.

#### Scenario: Parar a resposta

- **WHEN** a resposta está em stream e o usuário tecla `Esc`
- **THEN** o stream é abortado, o botão volta a "Enviar" e a região viva anuncia a interrupção

### Requirement: Citações navegáveis

O link `cite:<id>` MUST virar um chip numerado com prévia no hover e no foco (dispositivo,
documento, começo do texto citado e vigência). O clique SHALL abrir o painel de citação (Drawer
abaixo de 768 px) com documento, versão, badge do intervalo de vigência, texto em `lang="pt-BR"`, a
chave do dispositivo, link da fonte, "copiar citação", "reportar", navegação por `[`/`]` e o link
"Abrir o dispositivo" para a página do dispositivo.

#### Scenario: Chip de citação

- **WHEN** o usuário clica no chip 1 de uma resposta
- **THEN** o painel mostra a citação S1 com o intervalo de vigência, e `]` passa para a S2
