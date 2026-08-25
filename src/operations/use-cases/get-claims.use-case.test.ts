import { findClaims } from '../repositories/claims.repository.ts'
import { getClaimsUseCase } from './get-claims.use-case.ts'

vi.mock(import('../repositories/claims.repository.ts'))

const claims = {
  banner: {
    title: { text: 'Elmwood Land Co', type: 'string' },
    summary: {
      sbi: { label: 'SBI', text: '113598882', type: 'string' }
    }
  },
  availableEntitlements: [],
  claimableEntitlements: [],
  claims: []
}

describe('getClaimsUseCase', () => {
  beforeEach(() => {
    vi.mocked(findClaims).mockResolvedValue(claims)
  })

  // The /grant-admin surface answers with the page, header included, so this
  // app makes one call rather than gathering the parts itself.
  test('returns the claims page held for an application', async () => {
    await expect(getClaimsUseCase('woodland', 'wood-1001')).resolves.toEqual(
      claims
    )
  })

  test('asks for the requested application', async () => {
    await getClaimsUseCase('woodland', 'wood-1001')

    expect(findClaims).toHaveBeenCalledWith('woodland', 'wood-1001')
    expect(findClaims).toHaveBeenCalledTimes(1)
  })
})
