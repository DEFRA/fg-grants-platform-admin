import { config } from './config.ts'
import { getFromGas } from './gas.ts'
import { wreck } from './wreck.ts'

vi.mock(import('./wreck.ts'), () => ({
  wreck: { get: vi.fn() } as never
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
