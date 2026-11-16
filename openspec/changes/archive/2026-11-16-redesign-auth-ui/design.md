# Design

## Context

A onda 1 do redesign deixou os tokens da logo, o `TekoLogo`, o `Card`, o botão `brand` e a guarda
de sessão; o backend do login por e-mail e senha (ADR 0036) deixou `signUpWithEmail`,
`signInWithEmail`, `EmailAuthError`, `useAuthProviders`, `useEmailSignIn` e `useEmailSignUp`, sem
tela. Esta onda faz a tela de entrada, o onboarding e as configurações. Em paralelo, outros agentes
refazem a landing com as páginas públicas e as telas internas do app; esta mudança só mexe na
capability `web-auth`.

Documentação consultada (Context7): Base UI `/mui/base-ui/v1.9.0` (`Tabs.Root`, `Tabs.List`,
`Tabs.Tab` com `data-active`, `Tabs.Panel`), Better Auth `/better-auth/better-auth/v1.7.15`
(`listAccounts`: `GET /list-accounts` com `providerId` por conta, `credential` para a senha) e cmdk
`/dip/cmdk` (`shouldFilter={false}`, `filter` e `loop`). As diretrizes de marca do botão
"Sign in with Google" pedem o "G" nas quatro cores, sem recolorir; o GitHub, o `mark-github` do
Octicons em uma cor só.

## Decisions

- **Métodos só do ambiente, com esqueleto e fallback.** A tela lê `useAuthProviders` e mostra
  GitHub e Google só quando a API tem os OAuth apps (localmente, nunca). Enquanto a lista carrega,
  um esqueleto com a forma dos botões, das abas, dos campos e do envio, que também é o fallback do
  `<Suspense>` no HTML estático. Se a lista falhar, passkey e e-mail, que a API sempre liga
  (`authMethodsOf`): quem tentar recebe o erro de rede da própria ação.
- **Formulário sem biblioteca de formulário.** Estado em React e validação por
  `validateEmailForm` (`src/lib/auth/email-form.ts`), que roda os mesmos `emailSignUpRequestSchema`
  e `emailSignInRequestSchema` da API e só traduz cada recusa em uma chave de mensagem. O erro de
  um campo aparece ao sair dele com algo digitado ou no envio (o foco vai para o primeiro
  inválido) e some assim que o valor fica válido; indo do campo direto para o envio, o erro espera o
  submit, para não empurrar o botão sob o clique. A falha da API vira um alerta acima do envio, com
  a mensagem de cada `failure`; `accountUnavailable` sugere o método de sempre sem afirmar que o
  e-mail tem conta.
- **Abas do Base UI, `ui/tabs.tsx` novo.** Controle segmentado (trilho em `--muted`, aba ativa em
  relevo), setas entre as abas. O formulário fica só no painel ativo, para os `id` dos campos não
  se repetirem; o e-mail digitado é estado do formulário e passa entre as abas.
- **Caixa de seleção nativa estilizada (`ui/checkbox.tsx`).** `<input type="checkbox">` com
  `appearance-none` e o visto por cima: continua acessível, com `required`, e clicável pelo
  Playwright (`check()`), sem `sr-only` sob um rótulo.
- **País com busca no popover com cmdk.** O gatilho é um `role="combobox"` rotulado pelo título do
  passo, com o país e o código; o popover tem a busca e a lista do cmdk (já no bundle da paleta de
  comandos) com `shouldFilter={false}` e o filtro próprio `searchCountries` (sem acento nem caixa,
  código exato e prefixo primeiro), testado em unidade.
- **Bundle.** O formulário de e-mail e o diálogo do onboarding viram chunks sob demanda
  (`next/dynamic`): o formulário chega junto com a lista de métodos, atrás do mesmo esqueleto; o
  onboarding só baixa para quem tem o cadastro pendente. Medido no export: 441,9 KiB gz de primeiro
  acesso, contra 434,2 KiB da onda 1 (orçamento de 500 KiB).
- **Método de entrada nas configurações por `GET /api/auth/list-accounts`.** É rota do Better Auth,
  pelo mesmo `apiClient` das outras; `credential` vira `email`, e provedores desconhecidos ficam de
  fora. Sem mudança na API nem no `/me`.
- **Configurações com navegação lateral.** Âncoras para as seções (`#account`, `#quota`,
  `#passkeys`, `#preferences`, `#data`, `#danger`), a seção em vista marcada por
  `IntersectionObserver` (`aria-current="location"`); no celular, uma faixa rolável. A exclusão sai
  da seção de dados para a zona de perigo, com borda destrutiva.
- **Entrada sem o cabeçalho e o rodapé do site.** A página tem o próprio topo (marca no celular,
  idioma e tema) e um rodapé curto; o painel da marca é um `<aside>` rotulado, escondido no celular.

## Risks / Trade-offs

- O e2e de e-mail faz um cadastro e três entradas por tentativa, contra o rate limit por IP da
  stack (5 cadastros a cada 10 minutos, 5 entradas por minuto): roda só no projeto desktop.
- `node --watch` da API (`pnpm --filter @teko/api dev`) reinicia em laço no Windows local e nunca
  abre a porta; sem `--watch` a API sobe. Fica registrado no relatório, fora desta mudança (API).
