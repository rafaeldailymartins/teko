import type { BrowserContext, CDPSession, Page } from '@playwright/test'

/*
 * Passkey do usuário de teste do staging num autenticador virtual do Chromium (CDP, domínio
 * `WebAuthn`). O `register-passkey.ts` cria a credencial pela tela real e a exporta com
 * `WebAuthn.getCredentials`; o system test a importa com `WebAuthn.addCredential` e entra pela
 * cerimônia de verdade. A credencial fica no segredo `SYSTEM_TEST_PASSKEY` do environment `staging`
 * do GitHub, no formato {@link StoredPasskey}, e nunca é impressa.
 */

/** Origem pública do staging (`WEB_ORIGIN` de `infra/vercel/env.staging.json`). */
export const STAGING_ORIGIN = 'https://tekoia-staging.vercel.app'

/** `rpID` da passkey: o host do `WEB_ORIGIN` (`apps/api/src/adapters/out/auth/better-auth.ts`). */
export const STAGING_RP_ID = new URL(STAGING_ORIGIN).hostname

/** Segredo do environment `staging` com a credencial. */
export const PASSKEY_SECRET_ENV = 'SYSTEM_TEST_PASSKEY'

/**
 * Credencial exportada. Os campos binários vão em base64 padrão, como o CDP os troca (o tipo
 * `binary` do protocolo); base64url também é aceito na leitura.
 */
export interface StoredPasskey {
  readonly version: 1
  readonly rpId: string
  /** Id da credencial (base64). */
  readonly credentialId: string
  /** Chave privada ECDSA P-256 em PKCS#8 (base64). */
  readonly privateKey: string
  /** `user.id` do WebAuthn (base64), que o login sem e-mail (credencial residente) devolve. */
  readonly userHandle: string
  /** Contador no momento da exportação; a importação usa um valor sempre maior (ver abaixo). */
  readonly signCount: number
}

export class PasskeySecretError extends Error {
  override readonly name = 'PasskeySecretError'
}

/** base64url (ou base64) → base64 padrão com padding, validado. */
function toBase64(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV}: ${field} ausente`)
  }
  const standard = value.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '')
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
  // Ida e volta pelo Buffer: o decoder ignora caracteres fora do alfabeto, então só base64 válido
  // (alfabeto e padding) volta idêntico. Sem regex, sem backtracking.
  if (Buffer.from(padded, 'base64').toString('base64') !== padded) {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV}: ${field} não é base64`)
  }
  return padded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lê e valida o JSON do segredo. A mensagem de erro nunca repete o conteúdo. `rpId` é o do
 * staging; o e2e passa o da stack de CI (`localhost`).
 */
export function parsePasskey(raw: string | undefined, rpId: string = STAGING_RP_ID): StoredPasskey {
  if (raw === undefined || raw.trim() === '') {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV} ausente`)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV} não é JSON`)
  }
  if (!isRecord(value) || value['version'] !== 1) {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV}: esperado um objeto com version 1`)
  }
  if (value['rpId'] !== rpId) {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV}: rpId precisa ser ${rpId}`)
  }
  const signCount = value['signCount']
  if (typeof signCount !== 'number' || !Number.isInteger(signCount) || signCount < 0) {
    throw new PasskeySecretError(`${PASSKEY_SECRET_ENV}: signCount inválido`)
  }
  return {
    version: 1,
    rpId,
    credentialId: toBase64(value['credentialId'], 'credentialId'),
    privateKey: toBase64(value['privateKey'], 'privateKey'),
    userHandle: toBase64(value['userHandle'], 'userHandle'),
    signCount,
  }
}

/**
 * Contador da importação. O servidor (SimpleWebAuthn, no plugin de passkey do Better Auth) recusa
 * uma asserção cujo contador não seja maior que o guardado, e cada run faz uma asserção a partir
 * do mesmo segredo: importar o `signCount` exportado falharia do segundo run em diante. Os segundos
 * desde 1970 crescem entre runs e cabem no `uint32` do contador até 2106.
 */
export function importSignCount(passkey: StoredPasskey, nowMs: number): number {
  return Math.max(passkey.signCount + 1, Math.floor(nowMs / 1000))
}

export interface VirtualAuthenticator {
  readonly cdp: CDPSession
  readonly authenticatorId: string
}

/**
 * Autenticador de plataforma (CTAP 2.1, transporte `internal`) com credencial residente e
 * verificação de usuário sempre aceita, presença simulada e sem a interface do Chrome.
 */
export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

/** Põe a credencial do segredo no autenticador virtual. */
export async function importPasskey(
  authenticator: VirtualAuthenticator,
  passkey: StoredPasskey,
  nowMs: number = Date.now(),
): Promise<void> {
  await authenticator.cdp.send('WebAuthn.addCredential', {
    authenticatorId: authenticator.authenticatorId,
    credential: {
      credentialId: passkey.credentialId,
      isResidentCredential: true,
      rpId: passkey.rpId,
      privateKey: passkey.privateKey,
      userHandle: passkey.userHandle,
      signCount: importSignCount(passkey, nowMs),
    },
  })
}

/** A única credencial do autenticador, no formato do segredo. */
export async function exportPasskey(
  authenticator: VirtualAuthenticator,
  rpId: string = STAGING_RP_ID,
): Promise<StoredPasskey> {
  const { credentials } = await authenticator.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: authenticator.authenticatorId,
  })
  if (credentials.length !== 1) {
    throw new PasskeySecretError(
      `o autenticador virtual tem ${credentials.length} credenciais; esperada exatamente 1`,
    )
  }
  const [credential] = credentials
  if (credential?.rpId !== rpId || credential.userHandle === undefined) {
    throw new PasskeySecretError(`credencial sem rpId ${rpId} ou sem userHandle`)
  }
  return parsePasskey(
    JSON.stringify({
      version: 1,
      rpId: credential.rpId,
      credentialId: credential.credentialId,
      privateKey: credential.privateKey,
      userHandle: credential.userHandle,
      signCount: credential.signCount,
    }),
    rpId,
  )
}
