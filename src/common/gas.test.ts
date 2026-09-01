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
      payload: { created: true }
    } as never)
  })

  test('returns the payload', async () => {
    await expect(postToGas('/entitlements', { a: 1 })).resolves.toEqual({
      created: true
    })
  })

  test('posts the given payload to the given path', async () => {
    await postToGas('/entitlements', { claimCode: 'ENT' })

    expect(wreck.post).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/entitlements`,
      expect.objectContaining({ json: true, payload: { claimCode: 'ENT' } })
    )
  })

  test('presents the service token', async () => {
    await postToGas('/entitlements', {})

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })
})
