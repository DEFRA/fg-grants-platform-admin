import { createClaimableItemUseCase } from './create-claimable-item.use-case.ts'
import { getClaimsUseCase } from './get-claims.use-case.ts'
import type { EntitlementTemplate } from '../repositories/claims.repository.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'

vi.mock(import('./get-claims.use-case.ts'))
vi.mock(import('../repositories/claims.repository.ts'))

const ENT = 'ENT_CS_CAPITAL_PA3'

const template = (overrides: Partial<EntitlementTemplate> = {}) =>
  ({
    claimCode: 'ENT_CS_CAPITAL_PA3',
    name: 'PA3 Woodland Management Plan entitlement',
    materialised: false,
    fields: {
      totalHectares: {
        input: true,
        label: 'Total area of eligible woodland',
        unitType: 'decimal',
        unit: 'HA'
      },
      reference: {
        input: true,
        label: 'Reference',
        unitType: 'string'
      },
      fixedLength: {
        input: false,
        value: 10,
        unitType: 'decimal',
        unit: 'M'
      }
    },
    maxEntitlements: 1,
    availableAt: { phase: 'PRE_AWARD' },
    ...overrides
  }) as EntitlementTemplate

const givenClaims = (availableEntitlements: EntitlementTemplate[]) =>
  vi.mocked(getClaimsUseCase).mockResolvedValue({
    availableEntitlements,
    claimableEntitlements: [],
    claims: []
  })

describe('createClaimableItemUseCase', () => {
  beforeEach(() => {
    givenClaims([template()])
  })

  test('creates the entitlement from what the form collected', async () => {
    await createClaimableItemUseCase('woodland', 'wood-1001', ENT, {
      totalHectares: '40.25',
      reference: 'WMP-1'
    })

    expect(createEntitlement).toHaveBeenCalledWith({
      clientRef: 'wood-1001',
      grantCode: 'woodland',
      claimCode: ENT,
      data: {
        totalHectares: { value: 40.25 },
        reference: { value: 'WMP-1' }
      }
    })
  })

  test('drops a posted field the template does not collect', async () => {
    await createClaimableItemUseCase('woodland', 'wood-1001', ENT, {
      totalHectares: '40.25',
      reference: 'WMP-1',
      unexpected: 'ignored'
    })

    const [{ data }] = vi.mocked(createEntitlement).mock.calls[0]

    expect(data).not.toHaveProperty('unexpected')
    expect(data).not.toHaveProperty('fixedLength')
  })

  test('refuses a claim code that is not available', async () => {
    await expect(
      createClaimableItemUseCase('woodland', 'wood-1001', 'ENT_UNKNOWN', {})
    ).rejects.toThrow('Claimable item ENT_UNKNOWN not found')

    expect(createEntitlement).not.toHaveBeenCalled()
  })

  test('refuses a materialised template', async () => {
    givenClaims([template({ materialised: true })])

    await expect(
      createClaimableItemUseCase('woodland', 'wood-1001', ENT, {})
    ).rejects.toThrow(`Claimable item ${ENT} not found`)
  })
})
