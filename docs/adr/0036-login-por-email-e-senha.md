---

status: accepted
date: 2026-11-16
decision-makers: Rafael Daily Santos Martins
---

# 0036 — Login por e-mail e senha, sem confirmação de e-mail nem recuperação de senha

## Contexto e problema

A [ADR 0019](0019-oauth-e-passkey.md) deixou o login só com OAuth (GitHub e Google) e passkey: sem
domínio próprio não há remetente de e-mail confiável, e e-mail e senha costuma depender de e-mail
para confirmar o endereço e recuperar a senha. Na prática, isso deixa o Tekó sem login local (sem
OAuth apps em development, a entrada só funciona pela sessão semeada) e obriga quem não quer ligar a
conta do GitHub ou do Google a desistir. O mantenedor decidiu, em 2026-11-16, oferecer e-mail e
senha em todos os ambientes (development, ci, staging e produção), **sem confirmação de e-mail e sem
recuperação de senha**, porque o projeto continua sem domínio e sem serviço de e-mail (custo zero).

Sem confirmação, qualquer pessoa pode cadastrar um e-mail que não é dela. O desenho precisa impedir
que isso vire tomada de conta (um cadastro por senha que depois recebe o login OAuth da vítima, ou o
contrário) e que as respostas da API revelem quais e-mails têm conta.

## Decisão

1. **`emailAndPassword` do Better Auth 1.7.18** em `/api/auth/sign-up/email` e
   `/api/auth/sign-in/email`, com `requireEmailVerification: false` e `autoSignIn: false`. O
   cadastro pede nome, e-mail e senha e nunca abre sessão; quem chama entra logo depois por
   `/sign-in/email`. Com `autoSignIn: false`, a proteção contra enumeração do Better Auth vale: o
   cadastro de um e-mail que já existe responde o mesmo 200 (usuário sintético, sem sessão), calcula
   um hash para igualar o tempo e não cria nem altera nada. A entrada responde o mesmo 401
   `INVALID_EMAIL_OR_PASSWORD` para e-mail sem conta, conta sem senha e senha errada.
2. **Política de senha** (`@teko/shared/contracts`, a mesma na API e no web): de 12 a 128
   caracteres, contados como o Better Auth conta (`string.length`, unidades UTF-16), sem regra de
   composição (NIST SP 800-63B) e sem aparar espaços. O hash é o padrão do Better Auth (scrypt,
   N = 16384, r = 16, p = 1, sal de 16 bytes), que normaliza a senha em NFKC antes de calcular. Um
   gancho `before` do Better Auth valida o cadastro: nome aparado de 1 a 80 caracteres, sem caractere
   de controle; e-mail de até 254; nada de foto nem de campo extra. O e-mail é gravado em minúsculas.
3. **Contas separadas por método.** `account.accountLinking` fica com `trustedProviders: []`,
   `allowDifferentEmails: false` e `updateUserInfoOnLink: false`, e o Better Auth só liga
   implicitamente um OAuth a um usuário cujo e-mail já está verificado (`requireLocalEmailVerified`,
   padrão ligado e que vira incondicional na próxima minor). A conta por senha nasce com
   `emailVerified: false` e nada a muda (as rotas de confirmação estão desligadas), então:
   - entrar com GitHub ou Google usando o e-mail de uma conta de senha volta para a entrada com
     `?error=account_not_linked`, sem sessão e sem vincular nada;
   - cadastrar senha com o e-mail de uma conta OAuth responde o 200 genérico e não cria credencial;
     a entrada com essa senha dá o 401 genérico;
   - entre GitHub e Google, que confirmam o e-mail, o vínculo implícito da ADR 0019 continua.
4. **Rotas que dependem de e-mail desligadas** (`disabledPaths`, 404): `/send-verification-email`,
   `/verify-email`, `/change-email`, `/request-password-reset` e `/reset-password`.
5. **Rate limit do Better Auth no banco, mais rígido nas rotas de e-mail**, por IP
   (`x-teko-client-ip`) e caminho: 5 entradas por minuto e 5 cadastros a cada 10 minutos (o padrão
   dele seria 3 a cada 10 s). A guarda de `Origin` de `/api/*` continua valendo para as duas rotas. A
   manutenção semanal apaga as janelas paradas há mais de um dia.
6. **Métodos de entrada públicos.** `GET /api/v1/auth/providers` (sem sessão, sem segredo, sem
   banco, `no-store`) devolve os métodos ativos na ordem da tela: os OAuth apps configurados, a
   passkey e o e-mail. Staging e produção continuam exigindo os dois OAuth apps no boot; development
   e ci sobem sem eles, com passkey e e-mail.
7. **O web continua sem o cliente do Better Auth** (ADR 0035): `signUpWithEmail` e `signInWithEmail`
   em `src/lib/api/auth.ts` passam pelo `apiClient`, e as falhas que a tela explica viram
   `EmailAuthError` (credenciais inválidas, conta indisponível no cadastro, senha curta ou longa,
   e-mail ou nome inválido, limite de tentativas).

## Consequências

- O hash da senha passa a ser dado pessoal tratado (`auth.account.password`): entra no registro de
  tratamento, sai na exclusão da conta (cascata) e nunca sai na exportação, que lista a conta como
  `email`. Os Termos e a política mudam de versão, e o onboarding pede o aceite de novo.
- Senha esquecida é conta perdida: não há como provar a posse do e-mail. As perguntas dela expiram
  em 90 dias, como as de qualquer conta.
- Quem cadastra primeiro um e-mail alheio bloqueia o dono de usar esse e-mail no GitHub ou no Google
  aqui (`account_not_linked`), mas não ganha acesso a nada dele. Os Termos explicam isso e apontam o
  canal de contato; o risco aceito é de negação de serviço, não de tomada de conta.
- O fluxo cadastro-e-entrada ainda deixa inferir, por tentativa, que um e-mail tem conta (o cadastro
  responde 200 e a entrada com a senha escolhida falha). Sem um canal de e-mail não há como evitar;
  as mensagens são genéricas e o rate limit por IP limita a varredura.
- Um usuário que entrou pelo GitHub e tenta o Google com o mesmo e-mail continua sendo vinculado
  (ambos confirmam o e-mail). Vincular um OAuth a uma conta de senha, se um dia for preciso, será
  explícito (`linkSocial` com sessão), nunca implícito.
- O e2e e o desenvolvimento local passam a ter um login real sem OAuth; o `seed:dev-session`
  continua para as jornadas que precisam de uma conta com onboarding pronto.
