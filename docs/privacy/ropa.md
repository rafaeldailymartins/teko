# Registro das operações de tratamento (LGPD, art. 37)

Registro do Tekó como controlador. Vale para a produção (`tekoia.vercel.app`) e para o staging
(`tekoia-staging.vercel.app`). Atualize no PR que mudar um dado coletado, uma finalidade, um
operador ou um prazo. O desenho está em
[`architecture/qualidade-e-seguranca.md`](../architecture/qualidade-e-seguranca.md#lgpd).

## Controlador

Mantenedor do projeto (pessoa física), contato pelo repositório
`github.com/rafaeldailymartins/teko`. Projeto gratuito, de código aberto (MIT) e sem fins
comerciais.

## Dados, finalidades e bases legais

| Dado                                                                                   | Finalidade                                          | Base legal (LGPD, art. 7º)             | Onde fica                            | Retenção                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| Nome, e-mail e foto do provedor OAuth (GitHub ou Google), ou nome e e-mail do cadastro | identificar a conta                                 | execução de contrato (Termos), V       | `auth.user` (Neon, São Paulo)        | até a exclusão da conta                          |
| Declaração 18+, versão dos Termos aceita e data, país de residência                    | maioridade, aceite, política regional de provedores | execução de contrato, V; obrigação, II | `auth.user`                          | até a exclusão da conta                          |
| Sessão (token, IP, user agent, validade)                                               | manter o login e limitar abuso                      | legítimo interesse, IX                 | `auth.session`                       | 7 dias sem uso; expiradas saem na semana         |
| Passkeys (chave pública, contador)                                                     | login sem senha                                     | execução de contrato, V                | `auth.passkey`                       | até a exclusão da conta                          |
| Hash da senha (scrypt com sal), só na conta por e-mail; o e-mail não é confirmado      | conferir a entrada por e-mail e senha               | execução de contrato, V                | `auth.account`                       | até a exclusão da conta                          |
| Pergunta **redigida** (CPF, CNPJ, e-mail, telefone e chave NF-e trocados) e resposta   | responder e mostrar o histórico                     | execução de contrato, V                | `app.questions`                      | 90 dias ou até excluir a conversa                |
| Polegar e motivo (sem texto livre)                                                     | qualidade das respostas                             | legítimo interesse, IX                 | `app.feedback`                       | junto da pergunta                                |
| Contadores de uso por dia                                                              | cotas do serviço gratuito                           | legítimo interesse, IX                 | `app.usage_daily`                    | até a exclusão da conta                          |
| IP e chave de usuário nas janelas de rate limit                                        | proteção contra abuso                               | legítimo interesse, IX                 | `app.rate_limits`, `auth.rate_limit` | janela de 60 s a 10 min; vencidas saem na semana |

Observabilidade e produto (F6), sem o texto cru da pergunta em nenhum deles:

| Dado                                                                                                                                                                                                       | Finalidade                        | Base legal (LGPD, art. 7º) | Onde fica                   | Retenção                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Eventos do catálogo (`packages/shared/src/analytics/events.ts`, sem texto livre), identificador aleatório do navegador e dados técnicos do evento (URL sem query, navegador, tela); respostas às pesquisas | medição de uso e pesquisas in-app | consentimento, I           | PostHog (UE)                | 1 ano (plano gratuito)                                                             |
| Erros do navegador e da API (mensagem, pilha, página sem query, versão, `trace_id`), depois do scrubber de PII                                                                                             | encontrar e corrigir falhas       | legítimo interesse, IX     | PostHog Error Tracking (UE) | 1 ano (plano gratuito)                                                             |
| Traces de LLM numa amostra: pergunta redigida (`PiiRedactor`), resposta, trechos, modelo, tokens e tempos; usuário só por hash                                                                             | qualidade e custo das respostas   | legítimo interesse, IX     | Langfuse Cloud Hobby (UE)   | acesso aos últimos 30 dias, sem apagamento automático; sai com a exclusão da conta |
| Traces, logs e métricas da API (rota, status, duração, `trace_id`), sem conteúdo de pergunta                                                                                                               | disponibilidade e desempenho      | legítimo interesse, IX     | Grafana Cloud Free (UE)     | 14 dias                                                                            |

A medição do navegador não se liga à conta: não há `identify`, e o `person_profiles:
'identified_only'` deixa os eventos sem perfil de pessoa. O IP da conexão chega ao PostHog, e o
projeto fica com "Discard client IP data" ligado.

No navegador, sem consentimento por serem necessários: o cookie de sessão, a preferência de tema
(`localStorage['teko-theme']`) e a escolha de consentimento (`localStorage['teko-consent']`, com a
versão da política e o momento, gravada só depois da decisão). Medição de uso e pesquisas dependem
dessa escolha: sem `analytics: true` o `posthog-js` nem é baixado; com ela, o SDK grava no
`localStorage` o identificador e o estado da sessão (`ph_<chave>_posthog`, `__ph_opt_in_out_<chave>`)
e, com as pesquisas, `seenSurvey_*` e afins, sem cookie. Retirar o consentimento faz o opt-out e
apaga essas chaves. O registro de erros e a telemetria técnica não gravam nada no navegador.

A pergunta crua nunca é gravada nem enviada: a redação de PII roda antes de qualquer uso, e os
logs de runtime não a registram.

## Operadores e transferências

| Operador                | Função                                  | Local                       | Dado que recebe                                                 |
| ----------------------- | --------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| Vercel                  | hospedagem do site e da API             | `gru1` (São Paulo)          | requisições; logs de runtime por 1 h, sem a pergunta crua       |
| Neon                    | banco de dados                          | AWS `sa-east-1` (São Paulo) | todos os dados acima                                            |
| Cloudflare (Workers AI) | embeddings e reranker                   | rede global                 | pergunta redigida                                               |
| Google (Gemini, free)   | geração da resposta                     | EUA                         | pergunta redigida e trechos da legislação                       |
| Groq                    | geração da resposta, com retenção zero  | EUA                         | pergunta redigida e trechos da legislação                       |
| GitHub e Google (OAuth) | login                                   | EUA                         | só o fluxo de login, iniciado pelo usuário                      |
| PostHog                 | analytics de produto, pesquisas e erros | UE (`eu.i.posthog.com`)     | eventos do catálogo e erros, sem a pergunta                     |
| Langfuse                | traces de LLM                           | UE (Langfuse Cloud EU)      | amostra: pergunta redigida, resposta, trechos; usuário por hash |
| Grafana Labs            | traces, logs e métricas da API          | UE (região da stack)        | telemetria técnica, sem a pergunta                              |

- O Gemini gratuito pode usar os prompts para treino: a UI avisa, só texto redigido sai, e quem
  declara residência ou acessa do Espaço Econômico Europeu, do Reino Unido ou da Suíça é atendido só
  pelo Groq com retenção zero (ADR 0007).
- PostHog, Langfuse e Grafana Cloud ficam na União Europeia: é transferência internacional (LGPD,
  art. 33), limitada ao que está nas tabelas acima. A stack do Grafana Cloud precisa ser criada numa
  região da UE; se for outra, corrija esta linha e a `/privacy`.
- Retenções dos planos gratuitos, pela documentação oficial: PostHog Free guarda eventos por 1 ano
  (inclusive os de erro); o Langfuse Hobby dá acesso aos últimos 30 dias, mas não apaga sozinho
  (retenção configurável só no Pro), então os traces saem pela exclusão da conta; o Grafana Cloud
  Free guarda logs, traces e métricas por 14 dias.

## Direitos do titular

- **Acesso e portabilidade:** `GET /api/v1/me/export` devolve, em JSON, perfil, contas ligadas
  (`github`, `google` ou `email`, sem tokens nem o hash da senha), número de passkeys, perguntas e
  feedback.
- **Exclusão:** `DELETE /api/v1/me` apaga a conta e, por cascata, sessões, contas (OAuth e a de
  senha, com o hash), passkeys, perguntas e feedback, além dos contadores de uso e das janelas de rate limit; os cookies de sessão
  são apagados na resposta. O apagamento nos terceiros (os traces do Langfuse pelo hash do usuário
  e, no PostHog, o que a API tiver enviado ligado à conta) roda logo depois; falha fica no log para
  tratamento manual. A medição do navegador não se liga à conta e não entra na exportação: os
  eventos ficam no PostHog, ligados só ao identificador aleatório do navegador, até o fim da
  retenção.
- **Exclusão de uma conversa:** `DELETE /api/v1/conversations/:id` (o menu ⋯ de cada conversa no
  histórico) apaga na hora, numa transação, as perguntas da conversa com as respostas, citações e o
  feedback. Os contadores de uso do dia ficam como estão (excluir não devolve a cota; eles não têm
  texto nem referência à pergunta), e o cache de respostas também (é anônimo e serve a todos). Com uma
  resposta ainda em andamento, a exclusão é recusada e o usuário tenta de novo depois.
- **Prazo:** até 15 dias para o que não for automático.
- **Conta por e-mail sem confirmação** ([ADR 0036](../adr/0036-login-por-email-e-senha.md)): o
  e-mail não é confirmado e não há recuperação de senha, porque o Tekó não envia e-mails. Um pedido
  sobre uma conta de senha só é atendido para quem está com a sessão dela (exportação e exclusão nas
  configurações); quem relata que o próprio e-mail está numa conta que não criou fala com o
  mantenedor pelo canal de contato.
- **Sessão revogada:** o login guarda um cache da sessão no cookie por até **5 minutos**. Uma sessão
  revogada (sign-out em outro dispositivo, ou a própria exclusão) pode continuar aceita por rotas que
  usam esse cache nesse intervalo, mas as que leem ou gravam dados pessoais (exportação, exclusão da
  conta ou de uma conversa e pergunta) consultam o banco e a recusam na hora; depois da exclusão, não há mais dado a ler.

## Segurança

Sessão por cookie `HttpOnly`, `SameSite=Lax` e `__Secure-`; checagem de `Origin` em toda mutação;
senha só como hash scrypt com sal, com rate limit por IP na entrada e no cadastro, e sem vínculo
entre a conta de senha e um OAuth com o mesmo e-mail;
redação de PII antes do LLM e dos logs; banco acessado só pelo role `teko_app` (sem DDL); segredos
como env vars Sensitive da Vercel; opt-out de Model Training da Vercel; dependências com
proveniência e varredura de vulnerabilidades (ver
[qualidade e segurança](../architecture/qualidade-e-seguranca.md)).
