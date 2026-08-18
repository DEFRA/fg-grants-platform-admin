import { findClaims } from '../repositories/claims.repository.ts'
import { getClaimsUseCase } from './get-claims.use-case.ts'

vi.mock(import('../repositories/claims.repository.ts'))

describe('getClaimsUseCase', () => {
  test('returns the claims held for an application', async () => {
    const payload = {
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: []
    }
    vi.mocked(findClaims).mockResolvedValue(payload)

    await expect(getClaimsUseCase('woodland', 'wood-1001')).resolves.toEqual(
      payload
    )
    expect(findClaims).toHaveBeenCalledWith('woodland', 'wood-1001')
  })
})
