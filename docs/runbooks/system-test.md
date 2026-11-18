# Runbook: passkey do system test (`SYSTEM_TEST_PASSKEY`)

O system test do staging (`.github/workflows/system-test.yml`, `apps/web/system/`) entra com um
usuário persistente de teste por passkey: a credencial fica no segredo `SYSTEM_TEST_PASSKEY` do
environment `staging` do GitHub e é importada num autenticador virtual do Chromium a cada run
([arquitetura](../architecture/ci-cd-e-ambientes.md#system-test)). Sem o segredo, o job avisa e
termina verde. A credencial nunca passa pelo chat, pelo terminal (vai por pipe) nem pelo
repositório.

## Registrar a passkey (uma vez, depois do primeiro deploy do staging)

1. **Conta de teste.** Em `https://tekoia-staging.vercel.app/pt-BR/sign-in/`, aba "Criar conta",
   crie a conta com um e-mail só dela (por exemplo `system-test@<seu domínio>`; o Tekó não envia
   e-mail) e uma senha longa, guardada no seu gerenciador de senhas. Conclua o onboarding (18+ e
   Termos) na mesma sessão: sem ele o chat fica bloqueado.
2. **Chromium do Playwright** na sua máquina, se ainda não tiver:
   `pnpm --filter @teko/web exec playwright install chromium`.
3. **Registrar e gravar o segredo**, na raiz do repositório, num terminal interativo (PowerShell,
   Windows Terminal ou um terminal Unix; no Git Bash do mintty o stdin não é TTY), com o `gh`
   autenticado:

   ```bash
   node apps/web/system/register-passkey.ts | gh secret set SYSTEM_TEST_PASSKEY --env staging
   ```

   O script pede o e-mail e a senha (sem eco), entra no staging num Chromium sem interface com um
   autenticador virtual, cadastra a passkey "system test (CI)" em Configurações → Passkeys, exporta
   a credencial (`WebAuthn.getCredentials`), confere que ela entra sozinha num navegador novo e só
   então escreve o JSON no stdout, que o pipe entrega ao `gh secret set`. Mensagens e erros vão para
   o stderr. Se ele falhar, o pipe entrega um stdout vazio e o `gh secret set` grava o segredo
   **vazio** assim mesmo (e diz "Set Actions secret"): o system test trata o vazio como ausente,
   avisa e fica verde sem testar nada. Corrija o erro e rode de novo; se ele falhou depois do
   cadastro, remova antes a passkey "system test (CI)" nas configurações da conta de teste.
4. **Conferir:** `gh secret list --env staging` mostra `SYSTEM_TEST_PASSKEY`; dispare o
   `system-test.yml` (`gh workflow run system-test.yml --ref main`) e veja o job verde **sem** o
   aviso "Sem o segredo SYSTEM_TEST_PASSKEY" (com o aviso, o segredo ficou vazio).

## Formato do segredo

Um objeto JSON numa linha, com os campos binários em base64 padrão (o tipo `binary` do CDP;
base64url também é aceito):

| Campo          | Conteúdo                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `version`      | `1`                                                                      |
| `rpId`         | `tekoia-staging.vercel.app` (o host do `WEB_ORIGIN` do staging)          |
| `credentialId` | id da credencial                                                         |
| `privateKey`   | chave privada ECDSA P-256 em PKCS#8                                      |
| `userHandle`   | `user.id` do WebAuthn, que o login sem e-mail (credencial residente) usa |
| `signCount`    | contador no momento da exportação                                        |

Quem tem o segredo entra na conta de teste do staging, e só nela: a conta não tem papel especial, e
a passkey só vale no `rpID` do staging.

## Contador de assinaturas (`signCount`)

O servidor recusa uma asserção cujo contador não seja maior que o último guardado (SimpleWebAuthn,
dentro do plugin de passkey do Better Auth), e todo run parte do mesmo segredo. Por isso o system
test importa a credencial com `max(signCount + 1, segundos desde 1970)`
(`apps/web/system/support/passkey.ts`): o valor cresce entre runs sem regravar o segredo. Não
rode o system test com o relógio da máquina atrasado. Se o login falhar com "Response counter
value ... was lower than expected", alguém autenticou com um contador maior (por exemplo, um relógio
adiantado): registre uma passkey nova.

## Passkey revogada, conta excluída ou rotação

O system test reprova no login. Para trocar a credencial:

1. entre na conta de teste com e-mail e senha e remova a passkey "system test (CI)" em
   Configurações → Passkeys (ou crie a conta de novo, se ela foi excluída, e conclua o onboarding);
2. rode o passo 3 de novo: o `gh secret set` substitui o segredo.

Se o segredo vazar, remova a passkey na conta (isso basta para invalidá-lo) e registre outra.
