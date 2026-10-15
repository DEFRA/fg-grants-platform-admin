import Boom from '@hapi/boom'

import type { ClaimsAccess } from '../repositories/claims.repository.ts'
import { findClaims } from '../repositories/claims.repository.ts'
import { requireFullClaimsAccessUseCase } from './require-full-claims-access.use-case.ts'

vi.mock(import('../repositories/claims.repository.ts'))

const givenAccess = (access: ClaimsAccess) =>
  vi.mocked(findClaims).mockResolvedValue({
    availableEntitlements: [],
    claimableEntitlements: [],
    claims: [],
    access
  })

describe('requireFullClaimsAccessUseCase', () => {
  test('allows an operator GAS grants full access to the claims', async () => {
    givenAccess('full')

    await expect(
      requireFullClaimsAccessUseCase('woodland', 'wood-1001', 'create')
    ).resolves.toBeUndefined()
  })

  test.each([
    ['create', 'You do not have the required roles to create claimable items'],
    ['change', 'You do not have the required roles to change claimable items']
  ] as const)(
    'refuses an operator GAS grants view-only access to %s, naming the operation',
    async (operation, message) => {
      givenAccess('view-only')

      await expect(
        requireFullClaimsAccessUseCase('woodland', 'wood-1001', operation)
      ).resolves.toEqual({ message })
    }
  )

  test('asks GAS about the requested application', async () => {
    givenAccess('full')

    await requireFullClaimsAccessUseCase('woodland', 'wood-1001', 'create')

    expect(findClaims).toHaveBeenCalledWith('woodland', 'wood-1001')
  })

  test('leaves a failure from GAS to the caller', async () => {
    vi.mocked(findClaims).mockRejectedValue(Boom.serverUnavailable())

    await expect(
      requireFullClaimsAccessUseCase('woodland', 'wood-1001', 'create')
    ).rejects.toThrow('Service Unavailable')
  })
})
