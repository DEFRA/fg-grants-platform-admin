import { updateClaimableItemUseCase } from './update-claimable-item.use-case.ts'
import type { EntitlementTemplate } from '../repositories/claims.repository.ts'
import { updateEntitlement } from '../repositories/claims.repository.ts'

vi.mock(import('../repositories/claims.repository.ts'))

const template = {
  claimCode: 'ENT_CS_CAPITAL_PA3',
  name: 'PA3 Woodland Management Plan entitlement',
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: 'Total area of eligible woodland',
      unitType: 'decimal',
      decimalPlaces: 4,
      unit: 'HA'
    },
    actionCode: { input: false, value: 'PA3', unitType: 'string' }
  },
  maxEntitlements: 1,
  availableAt: [{ phase: 'PRE_AWARD' }]
} as EntitlementTemplate

const update = () =>
  updateClaimableItemUseCase(
    'woodland',
    'wood-1001',
    'entitlement-1',
    template,
    { totalHectares: ' 45.5 ', actionCode: 'PA4' },
    'Ada Lovelace'
  )

describe('updateClaimableItemUseCase', () => {
  test('sends only the scaled input fields, naming the person who asked', async () => {
    await expect(update()).resolves.toBeUndefined()

    expect(updateEntitlement).toHaveBeenCalledWith(
      {
        clientRef: 'wood-1001',
        grantCode: 'woodland',
        entitlementId: 'entitlement-1',
        data: { totalHectares: { value: 455000 } }
      },
      'Ada Lovelace'
    )
  })

  test('reports a refusal so the page can explain it', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      Object.assign(new Error('Response Error'), {
        isBoom: true,
        output: { statusCode: 409 },
        data: { payload: { message: 'It has a claim against it' } }
      })
    )

    await expect(update()).resolves.toEqual({
      statusCode: 409,
      message: 'It has a claim against it'
    })
  })

  test('lets a failure that is not the backend refusing through', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(new Error('socket hang up'))

    await expect(update()).rejects.toThrow('socket hang up')
  })
})
