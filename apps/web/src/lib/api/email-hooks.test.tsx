// @vitest-environment happy-dom
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME } from '../../../test/fake-api.ts'
import { apiClient } from './client.ts'
import { useEmailSignIn, useEmailSignUp } from './hooks.ts'
import { meQuery } from './queries.ts'
import { createQueryClient } from './query-client.ts'

/**
 * As mutações de e-mail e senha relêem o `/me` no sucesso (a guarda e o cabeçalho passam a ver a
 * sessão nova) e não mexem nele na falha.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT = { name: 'Ana', email: 'ana@example.com', password: 'uma senha longa' }

type Mutations = {
  signIn: ReturnType<typeof useEmailSignIn>
  signUp: ReturnType<typeof useEmailSignUp>
}

let latest: Mutations | null = null
let client: QueryClient
let root: Root
let status: number
let defaultBaseUrl: string | undefined

function Probe() {
  latest = { signIn: useEmailSignIn(), signUp: useEmailSignUp() }
  return null
}

function mutations(): Mutations {
  if (latest === null) {
    throw new Error('o Probe não montou')
  }
  return latest
}

beforeAll(() => {
  defaultBaseUrl = apiClient.getConfig().baseUrl
  apiClient.setConfig({ baseUrl: 'http://teko.test/api' })
})

afterAll(() => {
  apiClient.setConfig({ baseUrl: defaultBaseUrl ?? '/api' })
})

beforeEach(async () => {
  status = 200
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(status === 200 ? { token: 't' } : { code: 'X' }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
  client = createQueryClient()
  client.setQueryData(meQuery().queryKey, ME)
  root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  latest = null
})

function meInvalidated(): boolean {
  return client.getQueryState(meQuery().queryKey)?.isInvalidated === true
}

describe('useEmailSignIn e useEmailSignUp', () => {
  it('a entrada invalida o /me no sucesso', async () => {
    await act(() => mutations().signIn.mutateAsync(ACCOUNT))
    expect(meInvalidated()).toBe(true)
  })

  it('o cadastro invalida o /me no sucesso', async () => {
    await act(() => mutations().signUp.mutateAsync(ACCOUNT))
    expect(meInvalidated()).toBe(true)
  })

  it('a falha não mexe no /me', async () => {
    status = 401
    await act(async () => {
      await expect(mutations().signIn.mutateAsync(ACCOUNT)).rejects.toMatchObject({
        name: 'EmailAuthError',
        failure: 'invalidCredentials',
      })
    })
    expect(meInvalidated()).toBe(false)
  })
})
