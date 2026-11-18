# Design

## Context

A arquitetura (`docs/architecture/ci-cd-e-ambientes.md`, "Deploy e rollback", "Smoke" e "System
test") fixa o roteiro: smoke da URL única com o bypass de automação antes do `promote`, smoke do
domínio canônico depois, cerca de 15 requests sem LLM, e um system test no staging com o usuário de
teste entrando por passkey. Três mudanças da F7 correm juntas: `add-vercel-deployment` (WAF e env
sync), `add-deploy-pipelines` (o `deploy.yml`, que chama o smoke e o system test) e esta. O
`deploy.yml` é escrito em paralelo e chama `scripts/smoke.ts` pelo contrato combinado, então o
contrato da linha de comando não muda aqui sem mudar lá.

## Goals / Non-Goals

**Goals:**

- Um smoke único, testável sem rede, que sirva aos dois momentos do deploy (URL única e domínio
  canônico) e diga o que falhou e quanto cada request levou.
- Nenhum segredo fora do env do passo que o usa; o bypass só vai para uma URL única do projeto.
- System test real (login, stream, cache, recusa, idioma) com teto de gasto por run.
- Caminho da passkey do usuário de teste pronto para o mantenedor registrar e para o CI usar.

**Non-Goals:**

- Ligar os workflows no `deploy.yml` e no `release.yml` (mudança `add-deploy-pipelines`).
- Criar a conta de teste ou o segredo (o mantenedor faz, pelo runbook).
- Testar o stream de 90 s, o kill switch ou o Plano B (outros itens do DoD da F7).

## Decisions

- **Script Node sem dependências, não Playwright `request`.** A matriz de testes falava em
  Playwright `request` `@smoke`; o deploy roda o smoke num job que não instala o workspace, e o
  `fetch` do Node 24 com `redirect: 'manual'` faz tudo o que as checagens precisam. O script segue o
  padrão dos scripts da raiz (`parseArgs`, `cli-guards`, `node --test`) e importa as constantes das
  rotas da Vercel (`STATIC_HEADERS`, `ROOT_REDIRECT_HEADERS`, `LEGACY_HOST_REDIRECTS`) das mesmas
  fontes que geram o `config.json`: um header novo no estático entra no smoke sem edição.
- **`--base-url` amarrada ao ambiente.** No modo `canonical` ela precisa ser o `WEB_ORIGIN` de
  `infra/vercel/env.<env>.json`; no `deployment`, uma URL `https://<projeto>-<...>.vercel.app` sem
  caminho, porta nem query (na produção, nunca uma do staging). Assim o segredo do bypass nunca vai
  para outro host, e o smoke de produção não roda contra o staging por engano. `--out` passa pelo
  `resolveInsideRoot` e precisa terminar em `.json`.
- **Bypass por header, sem cookie.** O header `x-vercel-protection-bypass` vai em cada request da URL
  única (o `x-vercel-set-bypass-cookie` só serve a navegação de um browser, que o smoke não faz). O
  segredo nunca entra em log nem relatório (o texto de erro passa por um `redact`). A checagem
  `deployment-protection` repete o `/healthz` sem o header e espera 401/403 ou redirect para outro
  host (o login da Vercel, como no spike F1 (b)).
- **Retry só onde a Vercel tem atraso conhecido.** Logo depois do `promote`, o domínio ainda pode
  servir a deployment anterior por um instante (spike F1 (b)). Só o `/healthz` do modo canônico
  repete, só enquanto o `gitSha` for outro, 6 vezes com 5 s; as outras checagens rodam depois dele,
  uma vez cada, em sequência (o rate limit do stream é por IP).
- **Checagens.** `healthz` e `api-healthz` (sha, env, `no-store` em `/api`), redirect da raiz pelos
  dois `Accept-Language`, `/pt-BR/` e `/en/` (headers do estático, CSP com `default-src 'self'` e
  `frame-ancestors 'none'`, sem `unsafe-inline` em `script-src`, `lang`), duas leituras de
  `/api/v1/coverage` (sem `x-vercel-cache` HIT/STALE), stream sem sessão (401 `unauthenticated`, com
  o `Origin` canônico) e com `Origin` de outro site (403 `forbidden`); no canônico, também o WAF
  (`/api/qualquer-coisa` → 403; sem a regra, a API daria 404) e o domínio antigo (308 com o caminho);
  no deployment, a proteção da URL única. O WAF e o domínio antigo ficam fora do modo deployment: o
  domínio antigo só aponta para a deployment promovida.
- **`smoke.yml` sem environment.** O canônico não usa segredo; sem environment, a produção não pede
  aprovação a cada smoke. O sha vem do input (o deploy passa o da deployment) ou, no dispatch sem
  input, do `/healthz`.
- **System test como projeto Playwright à parte.** `playwright.system.config.ts` com `testDir:
  './system'` (o e2e continua em `./e2e`), Chromium só, 1 worker, nenhum retry (cada tentativa gasta
  cota) e sem trace nem vídeo (guardariam o cookie e as respostas). Host fixo no staging: a passkey só
  vale no `rpID` dele.
- **Passkey por CDP.** `WebAuthn.addVirtualAuthenticator` (CTAP 2.1, `internal`, credencial residente,
  UV sempre aceito) e `WebAuthn.addCredential` com a credencial do segredo; o registro usa a tela
  real das configurações e `WebAuthn.getCredentials`. O segredo guarda os campos binários em base64
  padrão (o tipo `binary` do CDP); base64url também é aceito na leitura.
- **Contador da assinatura.** O plugin de passkey do Better Auth usa o SimpleWebAuthn, que recusa uma
  asserção com contador menor ou igual ao guardado. Como cada run parte do mesmo segredo, a
  importação usa `max(signCount + 1, segundos desde 1970)`: cresce entre runs e cabe no `uint32` até
  2106. O e2e prova dois "runs" seguidos com o mesmo segredo.
- **Pergunta e data sem cache acidental.** O cache exato de respostas vale 7 dias e a chave leva a
  data. A pergunta sai do pool pelo `GITHUB_RUN_NUMBER` (`run % 30`) e o período gira entre os 24
  meses mais recentes que a família cobre, lidos do `GET /api/v1/coverage` público (`floor(run / 30)
  % 24`): o mesmo par só volta depois de 720 runs. A recusa usa o mês anterior ao início mais antigo
  da cobertura (ou o seguinte ao último `verifiedAt`), que o `CheckCoverage` recusa sem LLM e sem
  cota.
- **Teto de 2 gerações.** A primeira pergunta gera; a repetição precisa voltar do cache (se não
  voltar, ela gera a segunda e o teste reprova); a recusa fora da cobertura não gera. Uma recusa da
  busca ou do modelo na primeira pergunta reprova sem repetir: pergunta ruim no pool.
- **Registro pelo mantenedor.** `apps/web/system/register-passkey.ts` roda na máquina dele: e-mail e
  senha do TTY (a senha sem eco), nada por argumento ou env, a credencial só no stdout (o resto no
  stderr) e uma entrada de conferência com a credencial exportada antes de escrever. O pipe vai
  direto para `gh secret set SYSTEM_TEST_PASSKEY --env staging`, sem passar pelo chat.
- **E2E da passkey na stack de CI.** O mesmo módulo (`system/support/passkey.ts`) roda a cada PR que
  toca web ou API, com `rpID` `localhost` e uma conta própria (a sessão compartilhada do e2e não
  pode ganhar passkey), excluída no fim.

## Risks / Trade-offs

- [Pergunta do pool que o corpus não responde] → o teste reprova com a pergunta e a data na
  anotação; o pool é versionado e se corrige por PR.
- [Chromium sem as bibliotecas do sistema no runner] → o `ubuntu-24.04` do GitHub já traz o Chrome e
  as bibliotecas dele; o job instala só o browser (sem `--with-deps`, que exigiria os mirrors do apt
  no egress em `block`).
- [Passkey revogada ou conta excluída no staging] → o system test reprova no login; o runbook manda
  registrar de novo.
- [`x-vercel-cache` ausente em respostas da Function] → a checagem só reprova HIT ou STALE.

## Fontes Context7

| Biblioteca / serviço     | ID                                                         | Consulta                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                   | `/websites/vercel`                                         | Protection Bypass for Automation: header `x-vercel-protection-bypass` e `x-vercel-set-bypass-cookie` (só para navegação no browser)           |
| Chrome DevTools Protocol | `/chromedevtools/devtools-protocol`                        | domínio `WebAuthn`: `enable`, `addVirtualAuthenticator` (`VirtualAuthenticatorOptions`), `addCredential`, `getCredentials`; `binary` = base64 |
| Chrome DevTools Protocol | `/websites/chromedevtools_github_io_devtools-protocol_tot` | `WebAuthn.addCredential` e `WebAuthn.getCredential`                                                                                           |
| Playwright               | `/microsoft/playwright`                                    | `BrowserContext.newCDPSession`, `CDPSession.send` e os tipos do domínio `WebAuthn` no `protocol.d.ts`                                         |

O tipo `WebAuthn.Credential` (campos `credentialId`, `isResidentCredential`, `rpId`, `privateKey`
PKCS#8, `userHandle`, `signCount`) foi conferido no `playwright-core` 1.65.0 do lockfile
(`types/protocol.d.ts`). A regra do contador veio do `@simplewebauthn/server` que o
`@better-auth/passkey` 1.7.18 usa (`verifyAuthenticationResponse`).
