import { config } from './config.ts'
import { getFromGas, postToGas } from './gas.ts'
import { wreck } from './wreck.ts'

vi.mock(import('./wreck.ts'), () => ({
  wreck: { get: vi.fn(), post: vi.fn() } as never
}))

describe('getFromGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.get).mockResolvedValue({ payload: { ok: true } } as never)
  })

  test('returns the payload', async () => {
    await expect(getFromGas('/grants/woodland')).resolves.toEqual({ ok: true })
  })

  test('asks fg-gas-backend for the given path', async () => {
    await getFromGas('/grants/woodland')

    expect(wreck.get).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grants/woodland`,
      expect.objectContaining({ json: true })
    )
  })

  test('presents the service token', async () => {
    await getFromGas('/grants/woodland')

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })
})

describe('postToGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.post).mockResolvedValue({
      payload: { event: { status: 'RESUBMITTED' } }
    } as never)
  })

  test('returns the payload the backend answered with', async () => {
    await expect(
      postToGas('/grant-admin/events/gas/outbox/1/redrive')
    ).resolves.toEqual({ event: { status: 'RESUBMITTED' } })
  })

  test('posts to the given path', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grant-admin/events/gas/outbox/1/redrive`,
      expect.objectContaining({ json: true })
    )
  })

  test('presents the service token', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })

  // The one write that carries a body: park, and the reason an operator typed.
  test('sends the json body it was given', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/park', {
      payload: { reason: 'duplicate key on a case that no longer exists' }
    })

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        payload: { reason: 'duplicate key on a case that no longer exists' }
      })
    )
  })

  // Every write is somebody's decision, and the token this app presents names
  // the app. `x-actor` is what puts a person in the backend's audit record.
  test('names the person who asked', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive', {
      actor: 'Ada Lovelace'
    })

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`,
          'x-actor': 'Ada Lovelace'
        }
      })
    )
  })

  // An absent actor sends no header at all: a blank `x-actor` would be a claim
  // that nobody asked, which is a different thing from not saying who did.
  test.each([
    ['no options at all', undefined],
    ['an actor nobody could be identified as', { actor: undefined }]
  ])('sends no actor header given %s', async (_name, options) => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive', options)

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { authorization: `Bearer ${config.get('gas.serviceToken')}` }
      })
    )
  })

  test('sends no body when the write has none', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ payload: expect.anything() })
    )
  })

  // The status and the body both matter to the caller — a 409 names the status
  // that refused the write — so the Boom wreck throws is left exactly as it is.
  test('lets the backend failure through untouched', async () => {
    const failure = Object.assign(new Error('Response Error: 409 Conflict'), {
      output: { statusCode: 409 },
      data: { payload: { status: 'RESUBMITTED' } }
    })

    vi.mocked(wreck.post).mockRejectedValue(failure)

    await expect(
      postToGas('/grant-admin/events/gas/outbox/1/redrive')
    ).rejects.toBe(failure)
  })
})
