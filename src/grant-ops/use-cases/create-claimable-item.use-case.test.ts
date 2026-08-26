import { createClaimableItemUseCase } from './create-claimable-item.use-case.ts'
import type { EntitlementTemplate } from '../repositories/claims.repository.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'

vi.mock(import('../repositories/claims.repository.ts'))

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

describe('createClaimableItemUseCase', () => {
  test('creates the entitlement from what the form collected', async () => {
    await createClaimableItemUseCase('woodland', 'wood-1001', template(), {
      totalHectares: '40.25',
      reference: 'WMP-1'
    })

    expect(createEntitlement).toHaveBeenCalledWith({
      clientRef: 'wood-1001',
      grantCode: 'woodland',
      claimCode: 'ENT_CS_CAPITAL_PA3',
      data: {
        totalHectares: { value: 40.25 },
        reference: { value: 'WMP-1' }
      }
    })
  })

  test('drops a posted field the template does not collect', async () => {
    await createClaimableItemUseCase('woodland', 'wood-1001', template(), {
      totalHectares: '40.25',
      reference: 'WMP-1',
      unexpected: 'ignored'
    })

    const [{ data }] = vi.mocked(createEntitlement).mock.calls[0]

    expect(data).not.toHaveProperty('unexpected')
    expect(data).not.toHaveProperty('fixedLength')
  })

  test('sends a value without the whitespace around it', async () => {
    await createClaimableItemUseCase('woodland', 'wood-1001', template(), {
      totalHectares: ' 40.25 ',
      reference: ' WMP-1 '
    })

    const [{ data }] = vi.mocked(createEntitlement).mock.calls[0]

    expect(data).toEqual({
      totalHectares: { value: 40.25 },
      reference: { value: 'WMP-1' }
    })
  })
})

describe('when fg-gas-backend refuses the request', () => {
  const gasError = (statusCode: number, payload: object) =>
    Object.assign(new Error('Response Error'), {
      isBoom: true,
      output: { statusCode },
      data: { payload }
    })

  test.each([
    [
      404,
      'APPLICATION_NOT_FOUND',
      "No matching application found for clientRef 'wood-1001' and grantCode 'woodland'."
    ],
    [
      409,
      'ENTITLEMENT_LIMIT_EXCEEDED',
      "Cannot create entitlement 'ENT_CS_CAPITAL_PA3'. Maximum instance limit of 3 has been reached."
    ],
    [
      422,
      'INVALID_CLAIM_CODE',
      "Claim code 'ENT_CS_CAPITAL_PA3' is not defined for grant code 'woodland'."
    ]
  ])(
    'reports a %i so the page can explain it',
    async (statusCode, errorCode, message) => {
      vi.mocked(createEntitlement).mockRejectedValue(
        gasError(statusCode, { statusCode, errorCode, message })
      )

      await expect(
        createClaimableItemUseCase('woodland', 'wood-1001', template(), {
          totalHectares: '40.25'
        })
      ).resolves.toEqual({ statusCode, errorCode, message })
    }
  )

  test('lets a failure that is not the backend refusing through', async () => {
    vi.mocked(createEntitlement).mockRejectedValue(
      gasError(503, { message: 'Service Unavailable' })
    )

    await expect(
      createClaimableItemUseCase('woodland', 'wood-1001', template(), {
        totalHectares: '40.25'
      })
    ).rejects.toThrow('Response Error')
  })

  test('lets a connection failure through', async () => {
    vi.mocked(createEntitlement).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      createClaimableItemUseCase('woodland', 'wood-1001', template(), {
        totalHectares: '40.25'
      })
    ).rejects.toThrow('ECONNREFUSED')
  })
})
