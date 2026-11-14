# Design

## Context

O schema já leva tudo do usuário por `ON DELETE CASCADE` a partir de `auth.user` (sessões, contas,
passkeys, perguntas e feedback). Ficam fora da cascata as linhas que guardam o id dentro de um texto:
`app.usage_daily` (escopo `user:<id>`) e `app.rate_limits` (chave `…|user:<id>`).

## Decisions

- **Exclusão numa transação só** (`DELETE` do usuário, dos contadores e das janelas): nada fica pela
  metade. O apagamento nos terceiros roda depois, como tarefa pós-resposta com teto de 5 s; falha
  fica no log para o tratamento manual dentro do SLA de 15 dias. Até a F6 a lista de terceiros é
  vazia.
- **Sessão do banco nas rotas que leem ou gravam dados pessoais** (exportação, exclusão e a
  pergunta): o `cookieCache` de 5 min aceitaria a sessão de um usuário apagado, e a pergunta
  quebraria na FK. O custo é uma leitura de sessão por pergunta.
- **Cookies apagados na resposta do `DELETE /me`** pelos nomes que o Better Auth usa
  (`session_token`, `session_data`, `dont_remember`), com o prefixo do ambiente.
- **Expurgo pela CLI**, numa transação, com contagens em JSON para o log do workflow. O agendamento
  fica com o `ops.yml` da F6.
- **Exportação sem tokens:** das contas OAuth sai só o nome do provedor; das passkeys, a contagem.

## Risks / Trade-offs

- Rotas que usam o `cookieCache` (histórico, cota, perfil) podem aceitar uma sessão revogada por até
  5 min; depois da exclusão, não há mais dado do usuário para elas devolverem. A janela está no
  registro de tratamento.

## Context7

Sem biblioteca nova: Postgres (cascata e `DELETE … RETURNING`) e Better Auth (nomes de cookie,
conferidos no código do pacote, `better-auth/dist/cookies`).
