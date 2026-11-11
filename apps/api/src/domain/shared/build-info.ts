import { z } from 'zod'

/**
 * Identidade do artefato em execução: versão do release e SHA do commit do build.
 *
 * O smoke do deploy confere em `/healthz` que `gitSha` é o SHA esperado, então o valor
 * precisa ser canônico (hex minúsculo de 7 a 40 caracteres) ou o literal `unknown` quando o build
 * não informou o SHA (dev local, testes).
 */

export const UNKNOWN_GIT_SHA = 'unknown'

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/

/** SemVer 2.0 sem o `v` inicial: `0.1.0`, `0.0.0-abc1234`, `1.2.3-rc.1+build.5`. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const gitShaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => value === UNKNOWN_GIT_SHA || GIT_SHA_PATTERN.test(value), {
    error: 'GIT_SHA deve ser hex de 7 a 40 caracteres ou "unknown"',
  })

export const releaseVersionSchema = z.string().trim().regex(SEMVER_PATTERN, {
  error: 'a versão deve seguir SemVer 2.0 (ex.: 0.1.0 ou 0.0.0-abc1234)',
})

export interface BuildInfo {
  readonly version: string
  readonly gitSha: string
}

export interface BuildInfoInput {
  readonly version: string
  readonly gitSha?: string | undefined
}

/**
 * Valida e normaliza a identidade do build. Lança `ZodError` para versão fora do SemVer ou SHA
 * malformado: um valor errado aqui quebraria silenciosamente a verificação do deploy.
 */
export function createBuildInfo(input: BuildInfoInput): BuildInfo {
  return Object.freeze({
    version: releaseVersionSchema.parse(input.version),
    gitSha: gitShaSchema.parse(input.gitSha ?? UNKNOWN_GIT_SHA),
  })
}
