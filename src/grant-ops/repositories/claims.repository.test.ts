import { getFromGas, postToGas, putToGas } from '../../common/gas.ts'
import {
  createEntitlement,
  findClaim,
  findClaims,
  findEntitlement,
  updateEntitlement
} from './claims.repository.ts'

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

describe('findClaim', () => {
  test('reads the authoritative template for one claim', async () => {
    await findClaim('woodland', 'wood-1001', 'ENT_CS_CAPITAL_PA3')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/applications/wood-1001/claims/ENT_CS_CAPITAL_PA3'
    )
  })

  test('escapes every path segment', async () => {
    await findClaim('woodland/../admin', 'wood 1001', 'ENT/PA3')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/applications/wood%201001/claims/ENT%2FPA3'
    )
  })
})

describe('findEntitlement', () => {
  test('reads one entitlement, escaping every path segment', async () => {
    await findEntitlement('woodland/../admin', 'wood 1001', 'entitlement/1')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/applications/wood%201001/claims/entitlements/entitlement%2F1'
    )
  })
})

describe('createEntitlement', () => {
  const entitlement = {
    clientRef: 'wood-1001',
    grantCode: 'woodland',
    claimCode: 'ENT_CS_CAPITAL_PA3',
    data: { totalHectares: { value: 40.25 } }
  }

  test('posts the entitlement to the backend claims endpoint', async () => {
    await createEntitlement(entitlement)

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/applications/wood-1001/claims/entitlements',
      { payload: entitlement }
    )
  })

  test('names the person who asked', async () => {
    await createEntitlement(entitlement, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      payload: entitlement,
      actor: 'Ada Lovelace'
    })
  })

  test('escapes path segments', async () => {
    await createEntitlement({
      ...entitlement,
      grantCode: 'woodland/../admin',
      clientRef: 'wood 1001'
    })

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/applications/wood%201001/claims/entitlements',
      expect.anything()
    )
  })
})

describe('updateEntitlement', () => {
  const update = {
    clientRef: 'wood 1001',
    grantCode: 'woodland',
    entitlementId: 'entitlement/1',
    data: { totalHectares: { value: 455000 } }
  }

  test('puts the data to the entitlement, naming the person who asked', async () => {
    await updateEntitlement(update, 'Ada Lovelace')

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/applications/wood%201001/claims/entitlements/entitlement%2F1',
      { payload: { data: update.data }, actor: 'Ada Lovelace' }
    )
  })
})
