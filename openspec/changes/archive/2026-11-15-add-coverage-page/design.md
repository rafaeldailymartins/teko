# Design

## Context

Desenho em `docs/architecture/frontend.md` (UX, i18n e acessibilidade, orçamentos). A cobertura
efetiva vem de `GET /api/v1/coverage` (`coverageResponseSchema`): por família, a jurisdição, os
intervalos cobertos (já limitados pela última verificação e sem as lacunas, ordenados e disjuntos) e
o `verifiedAt`. `ProvisionTimeline` e `ProvisionDiff` existem desde a onda 2
(`add-history-and-provisions`), feitos para serem reaproveitados no painel. Esta é a parte "telas que
faltam e costuras" da onda 3; o axe e as jornadas de acessibilidade são do outro agente.

## Decisions

- **Sem mudança de API.** As lacunas mostradas são os trechos entre dois períodos cobertos da
  cobertura efetiva (`coverageGaps`); a API não manda as lacunas declaradas à parte, e o resultado
  para o usuário é o mesmo (o que fica fora). As fontes de cada família são texto do catálogo
  (`coverage.families.<chave>`, a partir do slug), como já é na landing; família desconhecida mostra
  o slug e nenhuma fonte, sem quebrar a página quando a ingestão ganhar uma família nova.
- **Página estática com os dados no navegador.** O título, a introdução, o cabeçalho e o rodapé vão
  no HTML exportado (a página continua legível e indexável sem JS); a lista vem de `useCoverage`.
  Fica fora do grupo `(app)`: sem `SessionGate`, sem `/me`.
- **Agrupada por jurisdição** (federal, depois Goiás), na ordem da API dentro do grupo. Cada família
  é um `article` com `dl` (períodos cobertos, lacunas, última verificação, jurisdição), datas na
  forma numérica e `time datetime` na verificação.
- **Barra decorativa numa escala comum.** Do começo mais antigo ao dia seguinte à verificação mais
  recente, com os trechos em porcentagem por `style` (atributo `style` é permitido pela CSP; nada de
  `<style>` em runtime). Fica `aria-hidden`: a lista diz o mesmo em texto, e a legenda mostra a
  escala. Cobertura em `--validity-current`, lacuna em `--coverage-out`, os tokens que já passam no
  teste de contraste.
- **Sem importar valor de `@teko/shared/contracts` na página.** O enum `Jurisdiction` trazia os
  schemas do Zod para o chunk da página (12,1 KiB gz só dela); com literais tipados, caiu para
  9,4 KiB gz.
- **Um componente de erro de consulta.** `QueryError` (mensagem de `errors.<code>` e "tentar de
  novo" quando o erro é repetível) serve a cobertura, a linha do tempo do painel e o `ProvisionDiff`,
  que repetiam o mesmo bloco.
- **Painel: linha do tempo ao abrir, diff no clique.** `CitationTimeline` pede a linha do tempo do
  dispositivo citado quando o painel monta (o painel já é sob demanda) e marca a redação vigente na
  data de referência da resposta (`displayedVersionIndex`, a mesma regra da página de dispositivo).
  "O que mudou" compara a redação anterior (no primeiro dia dela, `dateWithin`) com a vigente na data
  de referência (a própria data, ou o primeiro dia da mostrada quando nenhuma vigia nela) e só monta
  o `ProvisionDiff` no clique, com `lazy(() => import(...))`: código e consulta ficam fora do chunk
  do painel. Trocar de citação com `[`/`]` remonta a seção (chave por dispositivo e data) e fecha o
  diff. A linha do tempo do painel é só leitura (sem escolha): a navegação entre redações é da página
  de dispositivo, aberta pelo link "Abrir o dispositivo".
- **`aria-current` também na linha do tempo só leitura.** Antes ele só existia no botão; sem botão,
  a redação marcada ficava só na cor do ponto.
- **Títulos `h4` no painel.** O `h3` do painel é o rótulo da citação, que os testes e o leitor de tela
  usam como título do `article`.
- **Um helper de datas.** `src/lib/i18n/format.ts` ganha o estilo `numeric` (`01/05/2008`,
  `05/01/2008`, o das vigências e badges), `formatValidityBounds` (limites de `[from, to)` com o
  último dia incluído), `formatMonthName` (grade do seletor de período) e cache de formatadores.
  `calendarDate`, `CALENDAR_DATE_FORMAT` e `MONTH_FORMAT` (`lib/validity.ts`) e `lib/chat/format.ts`
  saem; o mês do histórico vira `formatTaxPeriod`, que dá o mesmo `MM/AAAA`. Instantes continuam no
  `format.dateTime` do next-intl (fuso do app), que não era duplicata.

## Bundle

Medido pelo pós-build (`firstLoadJsGzipKiB`, soma do JS gz de primeiro acesso de todos os HTML) e por
chunk (gzip do arquivo em `out/_next/static`):

| Medida                                    | Antes     | Depois    |
| ----------------------------------------- | --------- | --------- |
| First-load total (orçamento de 500 KiB)   | 402,6 KiB | 416,4 KiB |
| Chunk só da página de cobertura           | —         | 9,4 KiB   |
| Chunk do painel de citação (sob demanda)  | 4,4 KiB   | 7,0 KiB   |
| "O que mudou" no painel (`import()` no clique) | —    | 2,1 KiB   |

O aumento do first-load vem da página nova (que antes era só HTML) e de módulos repetidos no chunk
dela pelo particionamento do Turbopack; o painel e o diff continuam fora da soma.

## Context7

- `/websites/react_dev_reference`: `lazy` e `Suspense` para o diff carregado no clique.
- `/tanstack/query`: estados `isPending`/`isError` e `refetch` do `useQuery`.
- `/amannn/next-intl`: chaves de mensagem e `useTranslations` (o catálogo por família).
- `/websites/playwright_dev`: `getByRole('list', { name })`, `listitem` e `toHaveCount` nos e2e.
