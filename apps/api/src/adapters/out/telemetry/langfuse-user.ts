import { createHash } from 'node:crypto'

/**
 * Como a conta aparece no Langfuse (`userId` do trace): um hash do id, nunca o id nem o e-mail. O
 * apagamento (`DeleteMyData`) recalcula o mesmo valor para achar os traces do usuário.
 */
export function langfuseUserId(userId: string): string {
  return createHash('sha256').update(`teko-langfuse-user:${userId}`).digest('hex').slice(0, 32)
}
