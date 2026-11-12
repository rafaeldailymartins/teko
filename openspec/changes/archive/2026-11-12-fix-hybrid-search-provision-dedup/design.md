# Design

## Context

A busca híbrida da F2 (ADR 0010) funde três braços por RRF k = 60, cada um com até 50 chunks (10
no braço exato). Na fixture da F2, quase todo dispositivo tem um chunk só, e o efeito de
dispositivos com vários chunks não aparecia. No corpus real, os registros da EFD ICMS/IPI viram
um dispositivo `reg:<registro>` com a tabela de campos inteira, partido em vários chunks, ao
lado dos dispositivos `campo:<nn>`; os Guias e o RCTE têm o mesmo padrão em escala menor.

## Decisions

- **Deduplicar por `provision_version_id`, não por `stable_key`.** A coluna está em
  `corpus.chunks`, então os braços deduplicam sem `JOIN` a mais. Na data de referência, o filtro
  de vigência deixa uma versão por dispositivo, e a chave devolvida é a mesma.
- **Deduplicar dentro de cada braço, antes do `row_number()`.** Assim a posição de cada braço é a
  posição do dispositivo, e um dispositivo com dez chunks não empurra os outros para fora dos 50.
  O braço léxico usa `DISTINCT ON (pv)` sobre os 200 candidatos do primeiro estágio; o vetorial,
  sobre as 50 linhas do ANN, fora do CTE materializado (padrão da documentação do pgvector:
  filtros e pós-processamento fora do CTE com o `ORDER BY` da distância). O braço vetorial pode
  ficar com menos de 50 dispositivos distintos; o `corpus-eval` diz se vale aumentar o limite.
- **RRF por versão, com representante.** O `fused` agrupa por `pv` e soma os votos; o chunk
  devolvido é o de melhor posição entre os braços (`array_agg(id ORDER BY rnk, src)[1]`).
- **Braço exato pela versão.** A posição nos braços léxico e vetorial é procurada pela versão do
  dispositivo; entre os chunks da chave citada, vale o representante de um dos outros braços e,
  sem ele, o primeiro chunk (`ordinal`).

## Risks / Trade-offs

- **Menos candidatos distintos no braço vetorial.** Mitigado pelo próprio RRF (os braços léxico e
  exato continuam trazendo candidatos) e medido pelo `corpus-eval`.
- **Custo do `DISTINCT ON`.** Ordena no máximo 200 (léxico) e 50 (vetorial) linhas; o `sql-perf`
  com 100k chunks mede a mediana.

## Context7

| Biblioteca | ID                   | Consulta                                                                          |
| ---------- | -------------------- | --------------------------------------------------------------------------------- |
| pgvector   | `/pgvector/pgvector` | ANN em CTE materializado e pós-processamento fora dele; iterative scan com filtro |
