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

| Dado                                                                                 | Finalidade                                          | Base legal (LGPD, art. 7º)             | Onde fica                            | Retenção                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------- | ------------------------------------ | ---------------------------------------- |
| Nome, e-mail e foto do provedor OAuth (GitHub ou Google)                             | identificar a conta                                 | execução de contrato (Termos), V       | `auth.user` (Neon, São Paulo)        | até a exclusão da conta                  |
| Declaração 18+, versão dos Termos aceita e data, país de residência                  | maioridade, aceite, política regional de provedores | execução de contrato, V; obrigação, II | `auth.user`                          | até a exclusão da conta                  |
| Sessão (token, IP, user agent, validade)                                             | manter o login e limitar abuso                      | legítimo interesse, IX                 | `auth.session`                       | 7 dias sem uso; expiradas saem na semana |
| Passkeys (chave pública, contador)                                                   | login sem senha                                     | execução de contrato, V                | `auth.passkey`                       | até a exclusão da conta                  |
| Pergunta **redigida** (CPF, CNPJ, e-mail, telefone e chave NF-e trocados) e resposta | responder e mostrar o histórico                     | execução de contrato, V                | `app.questions`                      | 90 dias (expurgo semanal)                |
| Polegar e motivo (sem texto livre)                                                   | qualidade das respostas                             | legítimo interesse, IX                 | `app.feedback`                       | junto da pergunta                        |
| Contadores de uso por dia                                                            | cotas do serviço gratuito                           | legítimo interesse, IX                 | `app.usage_daily`                    | até a exclusão da conta                  |
| IP e chave de usuário nas janelas de rate limit                                      | proteção contra abuso                               | legítimo interesse, IX                 | `app.rate_limits`, `auth.rate_limit` | janela de 60 s; vencidas saem na semana  |

A pergunta crua nunca é gravada nem enviada: a redação de PII roda antes de qualquer uso, e os
logs de runtime não a registram.

## Operadores e transferências

| Operador                | Função                                 | Local                       | Dado que recebe                                           |
| ----------------------- | -------------------------------------- | --------------------------- | --------------------------------------------------------- |
| Vercel                  | hospedagem do site e da API            | `gru1` (São Paulo)          | requisições; logs de runtime por 1 h, sem a pergunta crua |
| Neon                    | banco de dados                         | AWS `sa-east-1` (São Paulo) | todos os dados acima                                      |
| Cloudflare (Workers AI) | embeddings e reranker                  | rede global                 | pergunta redigida                                         |
| Google (Gemini, free)   | geração da resposta                    | EUA                         | pergunta redigida e trechos da legislação                 |
| Groq                    | geração da resposta, com retenção zero | EUA                         | pergunta redigida e trechos da legislação                 |
| GitHub e Google (OAuth) | login                                  | EUA                         | só o fluxo de login, iniciado pelo usuário                |

- O Gemini gratuito pode usar os prompts para treino: a UI avisa, só texto redigido sai, e quem
  declara residência ou acessa do Espaço Econômico Europeu, do Reino Unido ou da Suíça é atendido só
  pelo Groq com retenção zero (ADR 0007).
- Langfuse (traces de LLM) e PostHog (produto e erros) entram na F6, com consentimento no navegador
  e retenção de 30 dias; este registro é atualizado no PR que os ligar.

## Direitos do titular

- **Acesso e portabilidade:** `GET /api/v1/me/export` devolve, em JSON, perfil, contas ligadas (sem
  tokens), número de passkeys, perguntas e feedback.
- **Exclusão:** `DELETE /api/v1/me` apaga a conta e, por cascata, sessões, contas OAuth, passkeys,
  perguntas e feedback, além dos contadores de uso e das janelas de rate limit; os cookies de sessão
  são apagados na resposta. O apagamento nos terceiros (PostHog e Langfuse, F6) roda logo depois;
  falha fica no log para tratamento manual.
- **Prazo:** até 15 dias para o que não for automático.
- **Sessão revogada:** o login guarda um cache da sessão no cookie por até **5 minutos**. Uma sessão
  revogada (sign-out em outro dispositivo, ou a própria exclusão) pode continuar aceita por rotas que
  usam esse cache nesse intervalo, mas as que leem ou gravam dados pessoais (exportação, exclusão e
  pergunta) consultam o banco e a recusam na hora; depois da exclusão, não há mais dado a ler.

## Segurança

Sessão por cookie `HttpOnly`, `SameSite=Lax` e `__Secure-`; checagem de `Origin` em toda mutação;
redação de PII antes do LLM e dos logs; banco acessado só pelo role `teko_app` (sem DDL); segredos
como env vars Sensitive da Vercel; opt-out de Model Training da Vercel; dependências com
proveniência e varredura de vulnerabilidades (ver
[qualidade e segurança](../architecture/qualidade-e-seguranca.md)).
