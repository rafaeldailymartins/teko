# Design

## Context

A onda 1 do redesign deixou os tokens da logo, o shell e os componentes de `src/components/ui`. As
telas internas continuavam com o visual do registry. Em paralelo, dois agentes fazem a landing (com
as páginas públicas e `/coverage`) e a entrada, o onboarding e as configurações; esta mudança só
toca as telas do app e o que elas usam.

Documentação consultada (Context7): AI SDK `/websites/ai-sdk_dev` (o `useChat` com `id`, e trocar
de conversa remontando a sessão pela chave), Streamdown `/vercel/streamdown` (`caret` com
`isAnimating`). O resto (Tailwind 4 container queries, lucide, Base UI `PreviewCard`, nuqs) segue o
uso que já existia no repositório.

## Decisions

- **O composer muda de lugar sem remontar.** Sem conversa, a abertura, o composer e as sugestões
  ficam centralizados; com conversa, a thread ocupa o espaço e o composer fica fixo embaixo, com um
  degradê do fundo. O bloco do composer mantém a mesma posição na árvore nos dois casos, então o
  texto digitado e o foco sobrevivem à troca.
- **A data em destaque é o motivo da logo.** O ponto âmbar anda sobre o fio de 1998 ao fim do ano
  corrente (`corpusTimelinePosition`); o botão com a data abre o mesmo seletor do chip do composer
  (o `Alt+D` continua). A posição vai no atributo `style`, que a CSP aceita; nada de `<style>`.
- **Sugestões sem repetição, todas sobre o corpus.** `DATE_COMPARISON_SUGGESTION` (a do DoD, com os
  botões "Perguntar em 05/2008" e "Perguntar em 01/2010", que os e2e usam) e `SUGGESTIONS`, uma por
  família, cada uma num período com redação vigente na fixture e em produção. O ícone vem da
  família (`FAMILY_ICONS`).
- **A sessão do chat segue o `c` da URL.** O `ChatSessionHost`, dentro do `ClientOnly` (lê a URL só
  no navegador, sem `Suspense` no HTML estático), guarda o id da sessão montada: quando o `c` muda
  por fora (histórico, botão voltar), monta uma `ChatSession` nova com `key` e ela relê as
  perguntas da conversa (`GET /questions?conversationId=`, o `useHistory` que já existia); quando o
  `c` some ("Nova conversa"), monta uma sessão vazia; quando a própria sessão grava o `c`, nada
  muda. Trocar de conversa fecha a citação aberta. O `?q=` sozinho continua relendo a pergunta.
- **Rolagem só no fim.** `useStickToBottom` ouve a rolagem do painel central e só desce a cada
  pedaço do stream se o usuário estiver a menos de 96 px do fim; rola até o `scrollHeight` (não até
  um marcador), para o composer fixo não cobrir o fim da resposta. Fora do fim aparece "Ir para o
  fim". Sem conversa, nada rola.
- **Leitura.** Resposta em 16 px, entrelinha 1,7 e medida de 70 caracteres; textos legais em serif
  (citação, dispositivo, diff). As fontes viram cartões com o botão estendido sobre o cartão (um
  alvo grande, um nome acessível "Fonte n: dispositivo"); com mais de quatro, o resto abre num botão,
  e a fonte aberta no painel nunca fica escondida.
- **Linha do tempo vertical única.** `ProvisionTimeline` (painel e página) desenha o fio do
  verde-folha ao petróleo e um marcador por redação: o ponto âmbar com halo na redação da data de
  referência, a folha cheia na vigente hoje, o círculo vazado nas outras, e o rótulo "Em
  dd/mm/aaaa" ao lado da marcada.
- **Diff legível.** Inserções em `--leaf-soft` com o texto em `--validity-current` e um traço
  verde-folha; remoções riscadas em `--coverage-out` sobre `--muted` (pares já conferidos pelo teste
  de contraste). `ProvisionDiff` ganha `layout`: `inline` (painel e página de dispositivo, com
  container query para o painel estreito) e `split` (comparação: antes à esquerda com as remoções,
  depois à direita com as inclusões, empilhados abaixo de `lg`).
- **Histórico por dia e busca local.** `groupHistory` agrupa no fuso de São Paulo (o mesmo da data de
  referência); `filterByTitle` ignora acento e caixa. A busca aparece a partir de quatro conversas
  carregadas e filtra só o que já veio da API (sem endpoint novo).
- **Componentes compartilhados sem mudar o padrão.** `Badge` ganha `size="sm"` e `className`; o
  `Workspace` ganha `historyActions` (o "Nova conversa"). `AppPageHeader` é o cabeçalho das páginas
  internas (rótulo com o marcador da folha, título em serif, ações e o fio da logo).

## Risks / Trade-offs

- Os botões de enviar e parar viraram só ícone: o nome acessível vem do `aria-label` ("Enviar",
  "Parar"), e o atalho aparece em `Kbd` ao lado.
- A busca do histórico só vê as páginas já carregadas; para achar conversas antigas é preciso
  "Carregar mais" (a API não filtra por título).
