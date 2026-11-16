# Proposal

## Why

O mantenedor reclamou de três coisas na entrada: GitHub e Google sem os símbolos, nenhuma forma de
entrar funcionando localmente (os botões de OAuth apareciam sem OAuth app, e não havia e-mail) e a
falta de e-mail e senha. O backend do login por e-mail e senha já existe (ADR 0036, mudança
`add-email-password-login`), mas o requisito "Entrada sem e-mail" do web ainda proíbe o formulário.
Esta é a onda 2 do redesign: entrada, cadastro, onboarding e configurações com cara de produto, no
visual da onda 1 (tokens da logo, `TekoLogo`, `Card`, `bg-brand-gradient`, `timeline-rule`).

## What Changes

- **Entrada em duas colunas no desktop:** o painel da marca (gradiente petróleo, a logo, a frase do
  produto e um exemplo em miniatura da linha do tempo de um dispositivo, com a data de referência em
  âmbar e a redação vigente em verde-folha) e o formulário; no celular, só a coluna do formulário,
  com a marca no topo. A página não usa mais o cabeçalho e o rodapé do site: tem o próprio topo
  (marca, idioma e tema) e um rodapé curto (aviso e legais).
- **Métodos conforme o ambiente:** a tela mostra só o que `GET /api/v1/auth/providers` devolve.
  GitHub e Google com os símbolos oficiais (o `mark-github` do Octicons e o "G" nas quatro cores do
  Google), passkey e o formulário de e-mail. Enquanto os métodos carregam, um esqueleto do mesmo
  tamanho; se a lista falhar, passkey e e-mail (sempre ligados na API).
- **E-mail e senha:** abas "Entrar" e "Criar conta" (o e-mail digitado passa de uma para a outra),
  campos com rótulo, mostrar a senha, medidor do mínimo de 12 caracteres, validação inline pelos
  schemas de `@teko/shared/contracts`, estado de envio, uma mensagem para cada `failure` (sem dizer
  se o e-mail tem conta) e o aviso de que não há confirmação de e-mail nem recuperação de senha, com
  link para os Termos.
- `account_not_linked` passa a dizer que o e-mail usa outro método de entrada; o aviso de
  `region_restricted` ganha o visual novo e o atalho para as configurações.
- **Onboarding:** cabeçalho no gradiente da marca com o progresso, passos numerados numa linha do
  tempo vertical que se marcam em verde-folha, caixas de seleção no cartão inteiro e o país com
  busca (sem acento nem caixa, por nome ou código). O comportamento não muda: bloqueante, novo aceite
  por versão dos Termos, sair como saída secundária. O diálogo vira um chunk sob demanda.
- **Configurações:** seções em cartões com título em serif e ícone, navegação lateral no desktop (a
  seção em vista marcada) e faixa de atalhos no celular. A conta mostra o método de entrada
  (`GET /api/auth/list-accounts`), a cota tem barra e o que resta do dia, as preferências são
  cartões de opção e a exclusão vai para a zona de perigo, separada da exportação.

## Capabilities

### Modified Capabilities

- `web-auth`: a entrada passa a oferecer e-mail e senha e a mostrar só os métodos do ambiente; o
  aviso de `account_not_linked`, o onboarding com o país com busca e as configurações com o método de
  entrada e a zona de perigo.

## Impact

- `apps/web`: `src/components/auth/*` (painel, formulário de e-mail, campos, país com busca, painel
  da marca, onboarding sob demanda, aviso de região), `src/components/settings/*`,
  `src/components/pages/{sign-in,settings}-page.tsx`, `src/components/brand/google-icon.tsx`,
  `src/components/ui/{tabs,checkbox}.tsx` (novos, sem mudar os existentes),
  `src/lib/api/{auth,queries,hooks}.ts` (`listSignInMethods`, `useSignInMethods`),
  `src/lib/auth/email-form.ts`, `src/lib/countries.ts` (`searchCountries`), `messages/*.json`, os
  testes unitários e os e2e `auth.spec.ts`, `email-auth.spec.ts` e `a11y.spec.ts`.
- `docs/architecture/frontend.md` (Conta).
- Sem mudança na API: `GET /api/auth/list-accounts` é rota do Better Auth que já respondia.
