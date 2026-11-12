# Overrides da revisão manual

Resoluções das anomalias de vigência que a ingestão manda para a `review_queue` (redações
`pending`: nota que o parser não entendeu, estilo incoerente, "EXAURIU-SE" ambíguo, linhas de
tabela sobrepostas, campo do Guia fora da vigência do documento). Cada arquivo `*.yaml` desta pasta
é uma lista de resoluções, aprovada por PR. O `cli ingest load` lê todos (menos os que começam com
`_`, como o [`_exemplo.yaml`](_exemplo.yaml)), aplica entre o parser e a gravação e registra no
relatório do run quantas resoluções valeram.

## Chave

`(stable_key, note_hash)`: a chave estável do dispositivo e o sha256 da nota que gerou a dúvida,
como gravados na `review_queue` do staging. O hash é o `content_hash` (texto normalizado) da nota
original, ou de `reason:<código>` quando a anomalia não tem nota. Para descobrir os dois:

```sql
SELECT stable_key, note_hash, reason, raw_note
FROM corpus.review_queue
WHERE status = 'open' ORDER BY stable_key;
```

Se a fonte mudar a nota, o hash muda e a resolução deixa de valer: a anomalia volta para a fila,
de propósito.

## Campos

| Campo          | Obrigatório          | Conteúdo                                                     |
| -------------- | -------------------- | ------------------------------------------------------------ |
| `stable_key`   | sim                  | Chave estável (`go:rcte:art:76:par:6`)                       |
| `note_hash`    | sim                  | sha256 hexadecimal minúsculo da nota                         |
| `action`       | sim                  | `approve`, `reject` ou `set_interval`                        |
| `valid_during` | só em `set_interval` | `{ from: AAAA-MM-DD, to: AAAA-MM-DD \| null }`, `[from, to)` |
| `reason`       | sim                  | Por que a anomalia foi resolvida assim                       |
| `reviewed_by`  | sim                  | Usuário do GitHub de quem revisou                            |
| `reviewed_at`  | sim                  | Data da revisão                                              |

- `approve`: a redação vale como o parser a leu (`review_status = approved`).
- `reject`: a redação fica gravada como `rejected`: não é buscada nem conta no `pv_no_overlap`.
- `set_interval`: a redação vale (`approved`) com o intervalo decidido; precisa de `from`.

A mesma chave em dois arquivos derruba o `load`. Schema e aplicação:
`apps/api/src/domain/corpus/overrides.ts`; leitura: `apps/api/src/adapters/in/cli/ingest/overrides-loader.ts`.
