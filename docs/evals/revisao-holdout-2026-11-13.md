# Revisão independente do holdout (2026-11-13)

Revisão assistida por LLM dos 53 casos de `apps/api/evals/datasets/holdout.yaml` (ADR 0031),
feita depois do primeiro `corpus-eval` contra o corpus real (staging, `corpus_version` 12, run
43403700598, código `b486c7a`). A curadoria original (2026-11-12) foi tratada como não confiável:
cada caso foi conferido de novo contra o texto da fonte.

## Método

- Fontes baixadas de novo em 2026-11-13 (User-Agent `teko-corpus-watch`): `RCTE.htm` e `CTE.htm`
  (modo `live`), pacotes XSD da EFD-Reinf 2.1.2d e 2.1.1 (sha256 iguais aos de
  `corpus/sources.yaml`) e as Tabelas de Goiás 5.1.1 v151, 5.2 v51 e 5.3 v47 do WS de Tabelas
  Externas.
- Os parsers da ingestão (`go-html-state-machine`, `reinf-xsd`, `sped-tabelas`) rodaram localmente
  sobre esses arquivos, sem banco e sem neurons; as chaves, vigências e textos esperados foram
  conferidos na saída deles. Para a EFD ICMS/IPI e a EFD de Goiás, os textos de
  `apps/api/test/fixtures/corpus/documents/` e o texto que o staging devolveu no `pool` do eval.
- Os `source_quote` novos foram conferidos literalmente (espaços colapsados) no HTML decodificado
  do RCTE e no TXT cp1252 das tabelas.
- Para os 13 casos que reprovaram, o que a busca devolveu (`hits`, `pool` de 50 candidatos e
  `diagnostics`) veio de `retrieval-evals-holdout.json` do run.

Pontos conferidos em cada caso: (a) pergunta natural e sem copiar o dispositivo; (b) dispositivos
esperados certos e completos; (c) `source_quote` que sustenta a resposta, na redação vigente na data;
(d) vigência e data de referência; (e) recusa, ambiguidade e sem-resposta coerentes com a cobertura.

## Resultado: 47 OK, 4 CORRIGIDO, 2 DÚVIDA

| Caso                                      | Veredito  | Motivo                                                                                                               |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| hold-rcte-aliquota-interna-2023           | OK        | Art. 20, I: 17% em [1998-01-01, 2024-04-01), confere com a NOTA do RCTE.                                             |
| hold-rcte-aliquota-interna-2025           | OK        | Art. 20, I: 19% desde 2024-04-01 (Decreto nº 10.485/24).                                                             |
| hold-aliquota-interna-lei-e-regulamento   | OK        | RCTE art. 20, I e CTE art. 27, I, ambos 19% desde 2024-04-01.                                                        |
| hold-rcte-etanol-en                       | CORRIGIDO | 23% está "sem efeitos" desde 23/06/2022 pela NOTA do inciso; vale 14,17% desde 15/07/2022.                           |
| hold-rcte-ovo-aliquota-reduzida           | OK        | Art. 20, § 1º, II, "a", item 4: 12%. Ver observações (isenção no Anexo IX, fora da cobertura).                       |
| hold-rcte-difal-uso-consumo               | DÚVIDA    | Esperado parcial para uma pergunta ampla: art. 65, III, art. 4º, § 1º, II e art. 12, IV também respondem.            |
| hold-rcte-local-difal-nao-contribuinte    | OK        | Art. 27, XII, "b", vigente desde 2022-04-05.                                                                         |
| hold-rcte-retificacao-efd-2010            | OK        | Art. 356-O: 30 dias em [2009-01-01, 2010-12-29).                                                                     |
| hold-rcte-retificacao-efd-2012            | OK        | Art. 356-O: 180 dias em [2010-12-29, 2013-01-01).                                                                    |
| hold-rcte-multa-efd-atraso                | OK        | Art. 371-A, II: R$ 700,65 por mês ou fração desde 2018-01-16.                                                        |
| hold-rcte-pva-en                          | OK        | Art. 356-L (PVA-EFD); o § 1º repete a assinatura, o caput basta.                                                     |
| hold-rcte-tabelas-de-goias-na-efd         | OK        | Art. 356-G, § 1º: tabelas 5.1.1, 5.2, 5.3 e 5.5.                                                                     |
| hold-cte-cesta-basica-2019                | OK        | CTE art. 27, II, "a" sem arroz e feijão em [2017-12-29, 2021-01-01). Ver observações (granularidade).                |
| hold-cte-cesta-basica-2022                | OK        | CTE art. 27, II, "a" com arroz e feijão desde 2021-01-01.                                                            |
| hold-efd-0000-ind-ativ                    | OK        | Registro 0000, campo 15: varejista informa "1 – Outros".                                                             |
| hold-efd-0000-perfil-en                   | OK        | Registro 0000, campo 14: [A, B, C].                                                                                  |
| hold-efd-0000-arquivo-substituto          | OK        | Registro 0000, campo 03: dentro do prazo, substitui.                                                                 |
| hold-efd-descricao-complementar-ajuste    | OK        | C197 e E111, campo 03; C597/C857/C897/D197 têm o mesmo texto para outros modelos.                                    |
| hold-efd-e110-recolher-negativo           | OK        | E110, campo 13: informa zero.                                                                                        |
| hold-efd-c170-ipi-decendial-en            | OK        | C170, campo 19: "1 - Decendial".                                                                                     |
| hold-efd-c190-fcp                         | OK        | C190, campo 07: inclui o FCP quando aplicável.                                                                       |
| hold-efd-c170-aliquota-zerada             | OK        | C170, campo 14: CST 00/10/20/70 exige alíquota maior que zero.                                                       |
| hold-efdgo-registro-1400                  | OK        | Item 4.2 do Guia de Goiás: 1400 não exigido (dispensado desde 01/01/2024).                                           |
| hold-efdgo-difal-no-prazo                 | OK        | Item 14.1 e código GO40000029 da Tabela 5.3 (desde 2015-03-01).                                                      |
| hold-efdgo-dpi-en                         | OK        | Item 9: obrigado à EFD está dispensado da DPI desde 2012.                                                            |
| hold-efdgo-fundeinfra                     | OK        | Item 1.4: registro E115 com códigos da Tabela 5.2.                                                                   |
| hold-efdgo-retificacao-sem-autorizacao    | CORRIGIDO | Faltava o art. 356-O, II: desde 11/11/2022 a retificação depois do prazo também dispensa autorização (erro de fato). |
| hold-tabgo-estorno-monofasico             | OK        | GO010074 desde 2023-05-01.                                                                                           |
| hold-tabgo-monofasico-credito-e-estorno   | OK        | GO020176 (desde 2023-04-28) e GO010074; são os únicos códigos com "monofásica".                                      |
| hold-tabgo-credito-outorgado-arroz-feijao | OK        | GO020156 desde 2017-11-01; GO090050 é o código de controle do mesmo crédito. Pergunta quase copia a descrição.       |
| hold-tabgo-feijao-goiano                  | CORRIGIDO | Pergunta pede todos os códigos; faltavam GO020052, GO020166 e GO090050, vigentes em 2026-09.                         |
| hold-tabgo-cte-substituto                 | OK        | GO20001002, redação de 2023-04-02.                                                                                   |
| hold-tabgo-protege-grupos-geradores       | CORRIGIDO | GO000162 (alínea "b") tem a mesma descrição do GO000116 (alínea "a"), ambos desde 2023-11-01.                        |
| hold-tabgo-transporte-aereo-en            | OK        | GO020098: crédito presumido de 4%, opcional.                                                                         |
| hold-reinf-r4010-laudo-molestia           | OK        | R-4010, rendIsento/dtLaudo.                                                                                          |
| hold-reinf-r4010-ir-retido-en             | OK        | R-4010, infoPgto/vlrIR.                                                                                              |
| hold-reinf-r2055-tipo-aquisicao           | OK        | R-2055, detAquis/indAquis: 1 a 7.                                                                                    |
| hold-reinf-r1000-desoneracao              | OK        | R-1000, infoCadastro/indDesoneracao: 0, 1.                                                                           |
| hold-reinf-r2060-atividade-e-valor        | OK        | R-2060, tipoCod/codAtivEcon e vlrCPRBapur.                                                                           |
| hold-reinf-r4040-natureza-en              | OK        | R-4040, ideNat/natRend.                                                                                              |
| hold-reinf-r2020-retencao-sofrida         | DÚVIDA    | O total retido por tomador (ideTomador/vlrTotalRetPrinc) também responde.                                            |
| hold-reinf-r4010-tipos-deducao            | OK        | R-4010, detDed/indTpDeducao: 1, 2, 3, 4, 5, 7, 8.                                                                    |
| hold-recusa-efd-2020                      | OK        | EFD ICMS/IPI coberta desde 2021-01-01 (Guia 3.0.6); a citação é fraca (capa do 3.1.9).                               |
| hold-recusa-reinf-2023-01-en              | OK        | EFD-Reinf coberta desde 2023-03-01 (leiaute 2.1.1).                                                                  |
| hold-recusa-anexo-ix-rcte                 | OK        | `rcte-anexos` sem cobertura (onda C3).                                                                               |
| hold-recusa-cte-futuro                    | OK        | 2028-03-10 depois do `verified_at`.                                                                                  |
| hold-recusa-rcte-antes-de-1998            | OK        | RCTE coberto desde 1998-01-01; a citação (caput do art. 20) não tem relação com a pergunta.                          |
| hold-sem-resposta-codigo-monofasico-2022  | OK        | GO010074 só existe desde 2023-05-01; nenhum código responde em 2022-06.                                              |
| hold-sem-resposta-iss-streaming           | OK        | O RCTE não trata de ISS.                                                                                             |
| hold-sem-resposta-folha-na-reinf          | OK        | A folha vai para o eSocial; nenhum evento da Reinf a recebe.                                                         |
| hold-sem-resposta-aliquota-ipi-en         | OK        | O Guia não traz alíquota de IPI.                                                                                     |
| hold-ambiguo-aliquota-dois-meses          | OK        | Duas datas no texto (03/2024 e 05/2024), mesmo molde do dev.                                                         |
| hold-ambiguo-nota-diesel-contra-pa        | OK        | Data da nota (10/02/2023) contra o PA (05/2024).                                                                     |

As correções estão no `holdout.yaml`, cada uma com o comentário
`# revisão independente (LLM) 2026-11-13: …` (o schema não tem campo de nota) e com `source_quote`
novo, conferido literalmente. Os dois casos em dúvida têm o comentário e nenhuma mudança no
esperado.

### O que mudou nos 4 casos corrigidos

- **hold-rcte-etanol-en.** A redação de 23% do art. 20, § 1º, VIII tem a NOTA "Redação do inciso
  VIII sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194, de
  2022, sendo que, a partir de 15 de julho de 2022, é aplicada a alíquota de 14,17%". Em 2024-06 a
  resposta é 14,17%. Fato e `source_quote` trocados para a NOTA; a vigência esperada saiu do caso,
  porque o parser grava o 23% como vigente desde 2018-01-01 e a vigência certa depende de como ele
  vai tratar essa nota (ver dúvidas). O dispositivo esperado continua o mesmo.
- **hold-efdgo-retificacao-sem-autorizacao.** Entrou `go:rcte:art:356-O:inc:II` (redação desde
  2022-11-11: "após o prazo de que trata o inciso I, independentemente de autorização da
  administração tributária, no caso em que houver prova inequívoca da ocorrência de erro de fato…")
  e o fato correspondente. O item 7 do Guia de Goiás registra a mesma dispensa ("O Estado de Goiás
  dispensou a autorização prévia de retificação da EFD por meio do Decreto nº 10.164"). Recebeu a
  tag `fora-da-fixture`, que faltava.
- **hold-tabgo-feijao-goiano.** Entraram GO020052 (crédito outorgado ao remetente na operação
  interestadual com feijão, desde 2021-01-01), GO020166 (PROGOIÁS RURAL, feijão, desde 2021-09-02) e
  GO090050 (crédito outorgado do momento da entrada, arroz ou feijão, desde 2017-11-01).
- **hold-tabgo-protege-grupos-geradores.** Entrou GO000162, com a mesma descrição do GO000116 e
  fundamento na alínea "b" do art. 11, LX, do Anexo IX. Recebeu a tag `varios-dispositivos` (o
  cabeçalho passou a contar 11 casos com mais de um dispositivo).

## Os 13 casos que falharam

| Caso                                    | recall@10 | Classificação              | Hipótese                                                                                                                                                                                                         |
| --------------------------------------- | --------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hold-rcte-aliquota-interna-2023         | 0         | ERRO DA BUSCA              | Inciso curto ("I - 17% … na operação e prestação internas") sem o caput "As alíquotas do imposto são"; fora até do pool de 50.                                                                                   |
| hold-rcte-aliquota-interna-2025         | 0         | ERRO DA BUSCA              | Mesmo chunk sem caput; os dispositivos de diferencial de alíquotas ("alíquota interna") ocupam o topo.                                                                                                           |
| hold-aliquota-interna-lei-e-regulamento | 0,5       | ERRO DA BUSCA              | O CTE art. 27, I aparece em 9º; o RCTE art. 20, I fica fora do pool, pelo mesmo motivo.                                                                                                                          |
| hold-rcte-etanol-en                     | 0         | AMBOS                      | Esperado errado (23% sem efeitos, corrigido); a busca também falhou: pergunta em inglês ("ethanol fuel" contra "álcool carburante") e inciso sem caput; vieram o art. 20-A, IV (etanol anidro, ad rem) e o § 6º. |
| hold-rcte-ovo-aliquota-reduzida         | 0         | ERRO DA BUSCA              | Chunks mínimos: "4. ovo;" e "II - 12% (doze por cento):"; o contexto está só no título do embedding. Nenhum dos dois no pool.                                                                                    |
| hold-rcte-difal-uso-consumo             | 0         | AMBOS (DÚVIDA)             | O art. 20, § 1º, IV fica fora do pool e a alínea "a" em 22º; mas o art. 4º, § 1º, II (6º) e o art. 65, III (8º) também respondem e não estão no esperado.                                                        |
| hold-rcte-local-difal-nao-contribuinte  | 0,5       | ERRO DA BUSCA              | Alínea "b" ("o do estabelecimento do remetente…") sem o caput "local da operação"; 15º no pool.                                                                                                                  |
| hold-cte-cesta-basica-2019              | 0         | ERRO DA BUSCA              | Evidência por ausência: a redação certa não contém "arroz" nem "feijão"; o inciso-pai vem em 1º e a alínea fica em 14º no pool.                                                                                  |
| hold-efd-c190-fcp                       | 0         | ERRO DA BUSCA              | Vocabulário: "fundo de combate à pobreza" casa com os campos VL_FCP_* (que trazem a expressão por extenso); o C190, campo 07 só tem a sigla FCP (15º no pool).                                                   |
| hold-efdgo-retificacao-sem-autorizacao  | 0,5       | AMBOS                      | Esperado incompleto (faltava o inciso II, corrigido); a busca não trouxe o art. 356-O, I: inciso sem caput e título errado no embedding (ver achados do parser).                                                 |
| hold-reinf-r2020-retencao-sofrida       | 0         | ERRO DA BUSCA (com DÚVIDA) | Confusão tomador/prestador: o R-2010 (serviços tomados) domina; o campo "Valor da retencao" é curto e fica em 28º no pool. O total por tomador (vlrTotalRetPrinc) também não veio.                               |
| hold-reinf-r4010-ir-retido-en           | 0         | ERRO DA BUSCA              | Inglês ("income tax withheld" contra "Valor da retencao do IR") e chunks de evento e de grupo genéricos no topo; o campo fica fora do pool.                                                                      |
| hold-reinf-r4040-natureza-en            | 0         | ERRO DA BUSCA              | O grupo-pai ideNat ("Identificacao da natureza do rendimento") vence o campo natRend, que estava em 6º no pool e saiu no reranker.                                                                               |

Resumo: 9 ERRO DA BUSCA, 3 AMBOS e 1 ERRO DA BUSCA com dúvida sobre a completude. Nenhum falhou só
por erro do esperado. O padrão dominante é o chunk de inciso, alínea, item ou campo curto, sem o
texto do dispositivo-pai: o título entra no embedding, mas não no texto que o braço lexical e o
reranker veem.

## Decisões do mantenedor (2026-11-13)

- O mantenedor revisou os 53 casos; o `reviewed_at` de todos é 2026-11-13.
- **Item 1 (`hold-rcte-difal-uso-consumo`): opção (a).** O esperado ganhou o art. 4º, § 1º, II, o
  art. 12, IV e o art. 65, III, com `source_quote` novo (art. 65, III). A pergunta não mudou.
- **Item 2 (`hold-reinf-r2020-retencao-sofrida`): o `vlrTotalRetPrinc` entra no esperado** ao lado do
  `vlrRetencao` (os dois são obrigatórios no R-2020), com `source_quote` novo.
- **Item 3 (nota "sem efeitos" no RCTE):** em correção no parser, junto com o título do "CAPÍTULO
  IV-A" (branch `fix/parser-rcte-notas-e-capitulo-iv-a`).
- **Item 4 (granularidade nas listas de produtos):** fica como regra a fixar na F4, sem mudar casos.

## Achados para o mantenedor (DÚVIDA e decisões pendentes, decididos acima)

1. **hold-rcte-difal-uso-consumo.** A pergunta ("como fica o ICMS devido a Goiás nessa entrada?")
   tem resposta em vários dispositivos. Decidir: (a) incluir no esperado o art. 65, III (cálculo do
   diferencial na aquisição para uso e consumo), o art. 4º, § 1º, II (incidência) e o art. 12, IV
   (base de cálculo); ou (b) manter só o art. 20, § 1º, IV e "a" e aceitar que o caso mede só a
   alíquota. Com (a), no run de hoje o caso iria de recall 0 e MRR 0 para 0,4 e 0,167.
2. **hold-reinf-r2020-retencao-sofrida.** O `ideTomador/vlrTotalRetPrinc` ("Valor da retencao
   principal das notas fiscais de servico") entra no esperado ao lado do `infoTpServ/vlrRetencao`?
   No run de hoje nenhum dos dois veio no top-10, então a métrica não muda.
3. **Nota "sem efeitos a partir de" no RCTE (decorre do etanol).** O `go-html-state-machine` não
   lê a NOTA que tira o efeito de uma redação: o art. 20, § 1º, VIII (23%) fica vigente desde
   2018-01-01, e o § 1º, IX tem a mesma situação ("sem efeitos de 23.06.22 a 29.04.23", gravado
   como contínuo). Decidir se o parser fecha a redação na data da nota (e, então, se o caso do
   etanol vira `unanswerable` em 2024-06 ou ganha a vigência nova) ou se a nota passa a ir para a
   `review_queue`. Até lá o caso não tem `validity`.
   **Parser corrigido em 2026-11-13** (`fix-rcte-sem-efeitos-e-titulos-acrescidos`, revisão 2): o
   VIII fica `[2018-01-01, 2022-06-23)` e o IX, `[2016-01-01, 2022-06-23)` e
   `[2023-04-30, 2023-06-01)`. Continua em aberto só a `validity` do caso do etanol.
4. **Granularidade do esperado nas listas de produtos.** O caso do ovo espera o inciso ("II - 12%")
   e o item ("4. ovo;"), sem a alínea "a" ("na operação interna com os seguintes produtos"); os da
   cesta básica esperam só a alínea, sem o inciso que tem a alíquota. Vale fixar uma regra (o
   dispositivo que contém a resposta, mais o pai que dá a alíquota?) e aplicá-la aos dois.

## Outras observações (sem mudança no caso)

- **Título errado no RCTE.** O parser não reconhece "CAPÍTULO IV-A DA ESCRITURAÇÃO FISCAL DIGITAL -
  EFD": os arts. 356-C a 356-S ficam com o `headingPath` "… CAPÍTULO IV - DOS LIVROS FISCAIS > Seção
  XII - Do Livro de Movimentação de Produto - LMP", e esse título entra no embedding de todos os
  dispositivos da EFD no RCTE. Corrigido em 2026-11-13 (a classe `PargrafoAlterador-titulo` passou
  a ser título; mais seis subseções e capítulos acrescidos no RCTE e um no CTE).
- **Ovo.** O Convênio ICM 44/75 isenta ovos, e Goiás costuma trazer isso no Anexo IX, que está fora
  da cobertura (onda C3); não deu para conferir no texto. A resposta "12%" está certa para a
  alíquota, mas pode ser incompleta na prática.
- **Citações das recusas.** Em `hold-recusa-efd-2020` (capa do Guia 3.1.9) e
  `hold-recusa-rcte-antes-de-1998` (caput do art. 20) o `source_quote` não mostra o limite da
  cobertura; melhor seria citar o `disabled_reason` de `corpus/sources.yaml` ou o início da
  vigência do RCTE.
- **Tags.** `hold-efdgo-difal-no-prazo` espera o GO40000029, que não está na fixture, mas o caso não
  tem a tag `fora-da-fixture`.
- **Perguntas próximas da descrição.** `hold-tabgo-credito-outorgado-arroz-feijao` e
  `hold-tabgo-protege-grupos-geradores` quase repetem a descrição da tabela ("aquisição" virou
  "compra"); não reescrevi, porque mudar a pergunta depois do eval é reescrever o caso.

## Efeito esperado nas métricas do holdout

Recalculado sobre os resultados do run 43403700598, sem rodar o eval de novo:

| Métrica                                                          | Antes            | Depois das correções |
| ---------------------------------------------------------------- | ---------------- | -------------------- |
| recall@10                                                        | 0,726 (42 casos) | ≈ 0,713              |
| MRR                                                              | 0,469            | 0,469                |
| vigência, recusa, clarificação, data de referência, sem resposta | 1,00             | 1,00                 |

- `hold-efdgo-retificacao-sem-autorizacao`: recall de 0,5 para 0,333 (o inciso II não veio no
  top-10).
- `hold-tabgo-feijao-goiano`: recall de 1 para 0,6 (o GO090050 veio em 3º; GO020052 e GO020166 não
  vieram).
- `hold-tabgo-protege-grupos-geradores`: continua 1 (o GO000162 veio em 2º).
- `hold-rcte-etanol-en`: continua 0; sai da conferência de vigência por não ter mais `validity`.
- O MRR não muda: em todos os casos corrigidos o primeiro dispositivo certo continua na mesma
  posição.

A distância até a meta de MRR 0,70 da F4 é da busca, não do conjunto: 10 dos 13 casos reprovados
estão certos, e as hipóteses acima (chunk sem o caput, inglês, grupo-pai contra campo, sigla contra
expressão por extenso) são o que medir no dev antes de voltar ao holdout.
