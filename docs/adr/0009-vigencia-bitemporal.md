---

status: accepted
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0009 — Vigência bitemporal: redações com `valid_during` e `knowledge`, cobertura limitada pelo `verified_at`

## Contexto e problema

A legislação fiscal muda por redações: o § 6º do art. 76 do RCTE foi acrescido pelo Dec. 5.825
(vigência a partir de 12.09.03), reescrito pelo Dec. 6.026 (04.11.04) e revogado pelo Dec. 7.028
(23.11.09). As fontes publicam snapshots consolidados que trazem todas as redações históricas, e
uma versão nova de documento às vezes corrige a anterior sem mudar a vigência. Como guardar isso
para que a busca devolva a redação certa para qualquer data, cite o documento de onde veio e
recuse quando o corpus não cobre a data?

## Fatores de decisão

- Toda resposta depende de uma data de referência (em geral o período de apuração).
- A vigência citada é a do dispositivo, não a do snapshot do documento.
- Correções de leitura (uma versão corretiva do Guia, uma anomalia revisada) não podem apagar o
  histórico do que o Tekó afirmava antes.
- Uma data posterior à última verificação das fontes não pode ser respondida como se estivesse
  coberta.

## Opções consideradas

- Uma linha por dispositivo com o texto vigente (sem histórico).
- Versões com só o tempo válido (`valid_during`).
- **Versões bitemporais: tempo válido (`valid_during`) e tempo de conhecimento (`knowledge`).**

## Decisão

Versões bitemporais, como no plano (seção "Modelo de dados"):

- `corpus.provision_versions` guarda cada redação com `valid_during` (meio-aberto, sempre com
  início) e `knowledge` (aberto enquanto a redação é a leitura atual); uma correção fecha o
  `knowledge` da linha anterior em vez de apagá-la. Os chunks repetem esses campos para o filtro
  ficar no mesmo `WHERE` do ANN.
- `pv_no_overlap` (EXCLUDE com GiST) impede redações publicáveis sobrepostas do mesmo dispositivo
  e modalidade; `pending` e `rejected` ficam fora, para a anomalia ir para a revisão sem abortar o
  documento.
- `document_versions.valid_during` descreve o snapshot (consolidados) ou o período do leiaute, e
  `chunk_sources` liga cada chunk a todas as versões de documento que o contêm; a citação escolhe a
  publicada que contém a data ou o snapshot mais recente.
- `corpus.coverage` guarda, por família, `covered` (`datemultirange`), `verified_at` e as lacunas
  (`gaps`, `datemultirange`, com o motivo em `gap_reason`). A cobertura efetiva é
  `covered * daterange(NULL, verified_at + 1) - gaps`. A coluna `gaps` não estava no plano: o
  `mark-coverage` precisa gravar o trecho a partir da data de efeito detectada, e o domínio subtrai
  o intervalo sem interpretar texto; o `teko_watch` ganhou `UPDATE` nela.
- A data de referência segue a precedência do plano (escolha explícita > data única no texto >
  mês anterior em `America/Sao_Paulo`), com `needs_clarification` para conflitos.

### Consequências

- Bom, porque a pergunta de 05/2006 recebe a redação do Dec. 6.026 mesmo com só o snapshot de
  2026 publicado (teste de integração e caso do golden).
- Bom, porque uma data depois do `verified_at` é recusada sem LLM, e o `source-watch` (F3) só
  precisa avançar uma data por dia.
- Ruim, porque cada redação vira linhas repetidas em `chunks` (campos desnormalizados), e as
  escritas precisam manter a invariante "todo chunk publicável tem fonte publicada" (conferida
  antes do commit).

## Mais informações

- Mudanças OpenSpec `add-validity-domain` e `add-corpus-schema` (F2).
- Plano: "Modelo de dados", "Data de referência, cobertura e recusa" e "Regras de vigência".
