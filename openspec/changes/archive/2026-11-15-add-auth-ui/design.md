# Design

## Context

Desenho em `docs/architecture/frontend.md` (UX, Privacidade) e `docs/architecture/backend.md`
(Autenticação); ADR 0019 (OAuth e passkey com o Better Auth 1.7). Web e API na mesma origem (ADR
0029), então a sessão é o cookie `HttpOnly` do Better Auth e o web nunca vê token. A camada de dados
(`web-data`) e o shell (`web-shell`) da onda 1 já estão na `main`. Esta é a parte de autenticação da
onda 2; a conversa, o histórico, os dispositivos, as páginas legais e o consentimento são de outras
mudanças.

## Decisions

- **Sem o cliente do Better Auth no web.** O `better-auth/client` com o `passkeyClient` mede ~15,5 KiB
  gz (esbuild, minificado: núcleo, `better-call`, `nanostores`, `@better-fetch/fetch` e o
  `@simplewebauthn/browser`), contra ~2,8 KiB gz do `@simplewebauthn/browser` sozinho, com o bundle
  já em ~327 KiB gz de 400. As rotas que o web usa são poucas e estáveis
  (`POST /sign-in/social`, `POST /sign-out` e as seis do plugin de passkey), então elas passam pelo
  `apiClient` do `src/lib/api` (o mesmo cliente gerado, com o interceptor que lança `ApiError`), e a
  regra do Biome que proíbe `better-auth` e `better-auth/**` no web continua inteira. A cerimônia
  WebAuthn usa o `@simplewebauthn/browser` (a mesma versão que o plugin de passkey da API resolve),
  carregado por `import()` no clique: fica fora do JS de primeiro acesso. O corpo da verificação
  segue o do `passkeyClient` (sem `clientExtensionResults`). O risco é o protocolo interno do plugin
  mudar numa versão nova; o Better Auth fica fixo no catálogo (1.7.18), e os testes de
  `src/lib/api/auth.ts` fixam caminhos e corpos.
- **Retorno seguro.** `safeReturnPath` só aceita caminho relativo da própria origem: recusa URL
  absoluta, `//host`, barra invertida, caractere de controle (C0, DEL e C1), `%2F`/`%5C` no caminho,
  `/api/` e a própria página de entrada (laço), com teto de 1.024 caracteres. São as recusas do
  `isSafeRelativeURL` do Better Auth, que confere de novo no servidor (`callbackURL` e
  `errorCallbackURL` passam pelo `originCheck`). O padrão é o chat do idioma. O `errorCallbackURL` é a
  própria entrada com o retorno, e o Better Auth anexa `?error=<código>`.
- **Erros do callback.** `access_denied` (o provedor) vira "cancelado"; `banned`, `user_banned` e
  `account_blocked`, "conta bloqueada"; os de vínculo de conta (`account_not_linked`,
  `unable_to_link_account`, `account_already_linked_to_different_user`), uma mensagem própria;
  `email_not_found`, "o provedor não compartilhou e-mail"; o resto, a genérica. `region_restricted`
  (código da API) vira a página de aviso na mesma rota (`regionRestrictedPath`), sem página estática
  nova: o export não tem rota dinâmica e a lista de páginas do shell continua a mesma.
- **Guarda de experiência no shell.** `SessionGate`, montada no layout do grupo `(app)`, lê o `/me`
  em cache: 401 manda para a entrada com `callbackURL` = caminho e query atuais (lidos de
  `window.location`, sem `useSearchParams` e o `<Suspense>` que ele exigiria no layout). O conteúdo
  estático continua renderizado enquanto o `/me` carrega; quem protege é a API. A mesma guarda assina
  os caches de consultas e mutações e leva à página de aviso qualquer `ApiError` `region_restricted`
  (a conversa recebe esse código do `POST /questions`).
- **Onboarding bloqueante.** Diálogo controlado (`open` fixo, sem `onOpenChange`,
  `disablePointerDismissal`): `Esc` e clique fora não fecham, e o Base UI prende o foco e torna o
  resto da página inerte, o que bloqueia o composer. As saídas são concluir ou sair da conta. Nas
  configurações ele não abre sozinho (exportar e excluir não podem depender do aceite); um aviso na
  conta abre o mesmo diálogo, que ali fecha. "Termos novos" é `acceptedTermsVersion` não nulo e
  diferente de `currentTermsVersion`. O `POST /me/onboarding` exige os três campos de novo (schema
  estrito), então o novo aceite repete 18+ e país (pré-preenchido com o salvo). A resposta é o `/me`
  atualizado, gravado no cache por `setQueryData`. `useSession().composerBlocked` é verdadeiro sem
  sessão, carregando ou com onboarding pendente: é o ponto de encaixe do composer.
- **País de residência.** `<select>` nativo com os 249 códigos ISO 3166-1 alpha-2 e os nomes do
  `Intl.DisplayNames` no idioma da interface (nenhuma tabela de nomes no bundle), padrão `BR`.
- **Avatar por iniciais.** A CSP só aceita imagens da origem (`img-src 'self' data:`); a foto do
  GitHub ou do Google ficaria bloqueada. O menu mostra as iniciais do nome.
- **Sair e excluir recarregam a página.** Depois do `POST /sign-out` ou do `DELETE /me` (que já apaga
  os cookies), `navigateTo` faz a navegação completa para a inicial: o cache de consultas e o estado
  da conversa da sessão que acabou somem sem limpeza manual. `src/lib/browser.ts` existe para os
  testes trocarem a navegação por um espião.
- **Exportação.** `GET /me/export` pelo SDK gerado; o JSON vira `Blob` e um link temporário com
  `download` (nome do `Content-Disposition`, só com caracteres seguros), sem `data:` (a CSP só os
  aceita em imagens). A URL do blob é liberada no ciclo seguinte.
- **Exclusão com confirmação digitada.** A palavra é traduzida (`EXCLUIR`, `DELETE`); a comparação
  ignora caixa e espaços nas pontas.
- **Passkeys.** Lista (`GET /passkey/list-user-passkeys`, validada com Zod), cadastro com nome
  opcional e remoção. Cadastrar exige sessão recente (o `freshSessionMiddleware` do Better Auth
  recusa a de mais de um dia): 401/403 nas opções vira "saia e entre de novo". Cancelamento do
  diálogo do navegador (`NotAllowedError`, `AbortError`, `ERROR_CEREMONY_ABORTED`) e autenticador já
  cadastrado têm mensagem própria. Sem WebAuthn (`PublicKeyCredential` ausente), o botão de entrar
  com passkey some depois da hidratação.
- **Densidade.** `data-density="compact"` no `<html>` reduz o `--spacing` do Tailwind em 1/8;
  guardada em `localStorage['teko-density']` como o tema. O script de bootstrap do tema passou a
  aplicar a densidade também: um script inline só, uma exceção só na regra do Semgrep
  (`teko-no-dangerously-set-inner-html`) e um hash só na CSP.
- **Imports `.ts` no cliente gerado.** Esta é a primeira tela que importa o SDK e as options geradas
  (até aqui só os testes importavam), e o Turbopack do `next build` não resolve
  `../client.gen.js` para o `.ts`. `output.module.extension: '.ts'` no `openapi-ts.config.ts` gera os
  imports como o resto do repositório já escreve; o conteúdo do cliente não muda.
- **E2E sem OAuth real.** A stack de CI não tem OAuth apps: a jornada intercepta
  `POST /api/auth/sign-in/social` (devolve uma URL de `/api/auth/...`) e para no redirect,
  conferindo o corpo (provedor, retorno e retorno de erro). A sessão de teste entra pelo cookie de
  `E2E_SESSION_COOKIE` (`e2e/support.ts`, que também reúne o registro de violações de CSP antes
  repetido no `platform.spec.ts`). Nenhuma jornada sai nem exclui a conta (a sessão é compartilhada
  pelos workers); o onboarding pendente é simulado sobre o `/me` real.

## Risks / Trade-offs

- Rotas do plugin de passkey chamadas sem o cliente oficial: uma mudança de protocolo numa versão
  nova do Better Auth quebraria a passkey em silêncio. Mitigação: versão fixa e os testes do
  `auth.ts`; a atualização do Better Auth confere as rotas.
- O bundle de primeiro acesso subiu de ~327 para 361,4 KiB gz: o SDK e as options do cliente gerado
  entram pela primeira vez numa página, mais o shell com sessão, a entrada e as configurações. Um
  `next/dynamic` no diálogo de onboarding foi medido e piorou (363,7 KiB, pelo runtime do carregador),
  e saiu.
- As páginas do app sem sessão mostram o HTML estático por um instante antes do redirect. É a
  consequência de não haver middleware no export estático.

## Context7

- `/better-auth/better-auth/v1.7.15`: `createAuthClient` e `passkeyClient` (para medir e comparar),
  `signIn.social` com `callbackURL`, `errorCallbackURL` e `disableRedirect`, `addPasskey`,
  `listUserPasskeys`, `deletePasskey` e o `?error=` do callback OAuth.
- `/masterkale/simplewebauthn/v13.3.0`: `startRegistration`, `startAuthentication` com `optionsJSON`,
  `browserSupportsWebAuthn` e `WebAuthnError`.
- `/mui/base-ui/v1.9.0`: `Dialog` controlado com `disablePointerDismissal`, `Menu` e `Input`.
- `/tanstack/query`: `useMutation` com `onSuccess`, `setQueryData`, `invalidateQueries` e as
  assinaturas do `QueryCache` e do `MutationCache`.
- `/vercel/next.js`: `useSearchParams` dentro de `<Suspense>` no export estático e `useRouter`.
- `/hey-api/hey-api`: `output.module.extension` para a extensão dos imports gerados.
