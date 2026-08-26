import { getFromGas } from '../../common/gas.ts'
import { findClaims } from './claims.repository.ts'

vi.mock(import('../../common/gas.ts'))

const payload = {
  availableEntitlements: [],
  claimableEntitlements: [],
  claims: []
}

describe('findClaims', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(payload)
  })

  test('reads the claims payload for a grant code and client reference', async () => {
    await expect(findClaims('woodland', 'wood-1001')).resolves.toEqual(payload)
  })

  test('calls the backend claims endpoint', async () => {
    await findClaims('woodland', 'wood-1001')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/applications/wood-1001/claims'
    )
  })

  test('escapes path segments', async () => {
    await findClaims('woodland/../admin', 'wood 1001')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/applications/wood%201001/claims'
    )
  })
})
