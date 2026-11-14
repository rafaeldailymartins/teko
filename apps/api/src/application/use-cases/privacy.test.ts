import { describe, expect, it, vi } from 'vitest'
import type { AccountExport, AccountRepository, ErasurePort } from '../ports/account-repository.ts'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import { createPrivacyUseCases, createPurgeExpiredData } from './privacy.ts'

const NOW = new Date('2026-11-10T15:00:00Z')

const DATA: AccountExport = {
  user: {
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.com',
    image: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    isAdult: true,
    termsVersion: '2026-11-14',
    termsAcceptedAt: null,
    countryOfResidence: 'BR',
  },
  linkedAccounts: ['github'],
  passkeys: 1,
  questions: [],
  feedback: [
    { questionId: 'q1', rating: 'down', reason: null, createdAt: new Date('2026-11-02T10:00:00Z') },
  ],
}

function setup(options: { exported?: AccountExport | null; deleted?: boolean } = {}) {
  const accounts: AccountRepository = {
    export: vi.fn(async () => (options.exported === undefined ? DATA : options.exported)),
    delete: vi.fn(async () => options.deleted ?? true),
  }
  const tasks: { name: string; task: Promise<unknown> }[] = []
  const backgroundTasks: BackgroundTasks = {
    run: (name, task) => {
      tasks.push({ name, task })
    },
    pending: () => 0,
    drain: async () => 0,
  }
  const erasure: ErasurePort = { name: 'posthog', eraseUser: vi.fn(async () => {}) }
  const privacy = createPrivacyUseCases({
    accounts,
    erasure: [erasure],
    backgroundTasks,
    clock: { now: () => new Date(NOW) },
  })
  return { privacy, accounts, tasks, erasure }
}

describe('createPrivacyUseCases', () => {
  it('exporta com datas em ISO', async () => {
    const { privacy } = setup()
    await expect(privacy.exportMyData('u1')).resolves.toEqual({
      exportedAt: '2026-11-10T15:00:00.000Z',
      user: { ...DATA.user, createdAt: '2026-11-01T10:00:00.000Z', termsAcceptedAt: null },
      linkedAccounts: ['github'],
      passkeys: 1,
      questions: [],
      feedback: [
        { questionId: 'q1', rating: 'down', reason: null, createdAt: '2026-11-02T10:00:00.000Z' },
      ],
    })
  })

  it('exporta termsAcceptedAt quando existe', async () => {
    const accepted = new Date('2026-11-03T00:00:00Z')
    const { privacy } = setup({
      exported: { ...DATA, user: { ...DATA.user, termsAcceptedAt: accepted } },
    })
    expect((await privacy.exportMyData('u1')).user.termsAcceptedAt).toBe('2026-11-03T00:00:00.000Z')
  })

  it('usuário que não existe mais → unauthenticated', async () => {
    await expect(setup({ exported: null }).privacy.exportMyData('u1')).rejects.toMatchObject({
      problem: { code: 'unauthenticated' },
    })
    await expect(setup({ deleted: false }).privacy.deleteMyData('u1')).rejects.toMatchObject({
      problem: { code: 'unauthenticated' },
    })
  })

  it('apaga e pede o apagamento nos terceiros como tarefa pós-resposta', async () => {
    const { privacy, accounts, tasks, erasure } = setup()
    await privacy.deleteMyData('u1')
    expect(accounts.delete).toHaveBeenCalledWith('u1')
    expect(tasks.map((task) => task.name)).toEqual(['erasure:posthog'])
    expect(erasure.eraseUser).toHaveBeenCalledWith('u1')
  })
})

describe('createPurgeExpiredData', () => {
  it('perguntas de mais de 90 dias e pending de mais de 1 dia', async () => {
    const purge = vi.fn(async () => ({
      questions: 1,
      expiredPending: 2,
      answerCache: 3,
      rateLimits: 4,
      sessions: 5,
      verifications: 6,
    }))
    const run = createPurgeExpiredData({
      maintenance: { purge },
      clock: { now: () => new Date(NOW) },
    })
    await expect(run()).resolves.toMatchObject({ questions: 1, verifications: 6 })
    expect(purge).toHaveBeenCalledWith(
      NOW,
      new Date('2026-08-12T15:00:00Z'),
      new Date('2026-11-09T15:00:00Z'),
    )
  })
})
