# Proposal

## Why

O mantenedor achou as telas internas do app sem graça: o chat vazio repetia a mesma sugestão em
dois cartões iguais, o estado vazio era um ícone com texto, e o composer e o chip de data pareciam
caixas soltas. Esta é a onda 2 do redesign: as telas internas (chat, histórico, dispositivo e
comparação) com cara de produto de pesquisa jurídica profissional, sobre os tokens e componentes da
onda 1, e o fluxo real revisado de ponta a ponta. No caminho apareceram problemas de usabilidade: a
conversa aberta pelo histórico não carregava as perguntas, não havia como começar uma conversa nova
e a rolagem automática arrastava o usuário para o fim mesmo quando ele subia para reler.

## What Changes

- **Chat vazio:** abertura com o selo, a saudação pelo nome, o que o Tekó responde e a data de
  referência em destaque como o ponto âmbar sobre o fio da linha do tempo do corpus (1998 a hoje),
  que abre o mesmo seletor do composer. O composer fica no meio da abertura. Sugestões sem repetir:
  em destaque, a pergunta do DoD em 05/2008 e 01/2010; abaixo, uma pergunta por família do corpus
  (EFD ICMS/IPI, EFD-Reinf, RCTE e EFD de Goiás), cada uma com ícone e o período certo.
- **Thread:** resposta em 16 px na medida de leitura; cabeçalho com o selo, a data e a vigência em
  `Badge`; rótulos de degradação com ícone; recusa, esclarecimento, cobertura e erro com estilo
  próprio; o "pensando" com a forma da resposta e o ponto âmbar andando no fio; cursor de stream;
  fontes em cartões (as quatro primeiras à vista); prévia do chip com o começo do texto citado;
  copiar a resposta e 👍/👎 discretos.
- **Composer:** um bloco só, com a área de texto, o chip de data, a cobertura, o contador, o atalho
  em `Kbd` e o botão redondo de enviar ou parar. Avisos (cota, cobertura, data inferida, dados
  pessoais) entram no topo do bloco.
- **Conversas:** abrir uma conversa do histórico relê todas as perguntas dela; "Nova conversa" no
  painel; a rolagem só acompanha o stream com o usuário no fim, com "Ir para o fim" quando ele sobe;
  o foco vai para o composer quando uma sugestão é enviada.
- **Painel de citação:** dispositivo em serif, documento, versão, badge de vigência, texto num
  cartão de leitura, ações e a linha do tempo vertical no motivo da logo (o ponto âmbar na redação
  da data de referência, a folha na vigente hoje).
- **Histórico:** conversas agrupadas por dia (hoje, ontem, 7 e 30 dias, anteriores), busca pelo
  título, data de referência em mono com o ponto âmbar e a conversa aberta marcada.
- **Dispositivo e comparação:** cabeçalho de página comum, texto em cartão de leitura, linha do tempo
  ao lado no desktop, busca com exemplos, diff legível (inserções em verde-folha, remoções
  riscadas) e, na comparação, antes e depois lado a lado no desktop e empilhados no celular, com
  estado vazio.

## Capabilities

### Modified Capabilities

- `web-chat`: abertura do chat vazio, conversas abertas pelo histórico, rolagem e composer.
- `web-history`: histórico por dia com busca e comparação lado a lado.

## Impact

- `apps/web`: `src/components/{chat,history,provision,compare,pages}`, `src/components/app-page-header.tsx`,
  `src/components/app-shell/workspace.tsx` (ações do painel de histórico), `src/components/ui/badge.tsx`
  (tamanho `sm`, sem mudar o padrão), `src/lib/{history,url-state}.ts`, `src/lib/chat/{suggestions,reference,markdown}.ts`,
  `messages/*.json` e os testes unitários e e2e do chat, do histórico e da acessibilidade.
- Sem dependência nova, sem mudança na API.
