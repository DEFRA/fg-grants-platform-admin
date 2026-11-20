import Boom from '@hapi/boom'

import { getFromGas } from '../../common/gas.ts'
import { getGrantTypes } from './grant-types.repository.ts'

vi.mock(import('../../common/gas.ts'))

const view = {
  grantTypes: [{ code: 'woodland', name: 'Woodland Management Plan' }]
}

describe('getGrantTypes', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(view)
  })

  test('returns the grant types view from GAS', async () => {
    await expect(getGrantTypes()).resolves.toEqual(view)
  })

  test('calls the grant-admin grants endpoint', async () => {
    await getGrantTypes()

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/grants')
  })

  test('accepts a grant type without a name', async () => {
    const unnamed = { grantTypes: [{ code: 'woodland', name: null }] }
    vi.mocked(getFromGas).mockResolvedValue(unnamed)

    await expect(getGrantTypes()).resolves.toEqual(unnamed)
  })

  test.each([
    ['no body', undefined],
    ['no grant types', {}],
    ['grant types that are not a list', { grantTypes: 'woodland' }],
    ['a grant type without a code', { grantTypes: [{ name: 'Woodland' }] }],
    ['a name that is not text', { grantTypes: [{ code: 'woodland', name: 1 }] }]
  ])('answers a bad gateway when GAS answers %s', async (_, body) => {
    vi.mocked(getFromGas).mockResolvedValue(body)

    await expect(getGrantTypes()).rejects.toMatchObject({
      message: 'GAS returned invalid grant types',
      output: { statusCode: 502 }
    })
  })

  test('rejects with the error GAS answered', async () => {
    const error = Boom.badGateway()
    vi.mocked(getFromGas).mockRejectedValue(error)

    await expect(getGrantTypes()).rejects.toBe(error)
  })
})
