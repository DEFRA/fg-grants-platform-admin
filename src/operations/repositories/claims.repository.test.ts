import { config } from '../../common/config.ts'
import { wreck } from '../../common/wreck.ts'
import { findClaims } from './claims.repository.ts'

vi.mock(import('../../common/wreck.ts'), () => ({
  wreck: { get: vi.fn() } as never
}))

const payload = {
  availableEntitlements: [],
  claimableEntitlements: [],
  claims: []
}

describe('findClaims', () => {
  beforeEach(() => {
    vi.mocked(wreck.get).mockResolvedValue({ payload } as never)
  })

  test('reads the claims payload for a grant code and client reference', async () => {
    await expect(findClaims('woodland', 'wood-1001')).resolves.toEqual(payload)
  })

  test('calls the backend claims endpoint', async () => {
    await findClaims('woodland', 'wood-1001')

    expect(wreck.get).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grant-admin/grants/woodland/applications/wood-1001/claims`,
      expect.objectContaining({ json: true })
    )
  })

  // Every fg-gas-backend route sits behind its bearer strategy, so a request
  // without this header is answered with a 401 rather than the payload.
  test('presents the service token', async () => {
    await findClaims('woodland', 'wood-1001')

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })

  test('escapes path segments', async () => {
    await findClaims('woodland/../admin', 'wood 1001')

    expect(wreck.get).toHaveBeenCalledWith(
      expect.stringContaining(
        '/grants/woodland%2F..%2Fadmin/applications/wood%201001/claims'
      ),
      expect.anything()
    )
  })
})
