import Boom from '@hapi/boom'

import { getFromGas } from '../../common/gas.ts'
import { getHome } from './home.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('getHome', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue({ grantTypeCount: 4 })
  })

  test('returns the home view from GAS', async () => {
    await expect(getHome()).resolves.toEqual({ grantTypeCount: 4 })
  })

  test('calls the grant-admin home endpoint', async () => {
    await getHome()

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/home')
  })

  test('accepts a count of none', async () => {
    vi.mocked(getFromGas).mockResolvedValue({ grantTypeCount: 0 })

    await expect(getHome()).resolves.toEqual({ grantTypeCount: 0 })
  })

  test.each([
    ['no body', undefined],
    ['no count', {}],
    ['a count that is not a number', { grantTypeCount: '4' }],
    ['a negative count', { grantTypeCount: -1 }],
    ['a fractional count', { grantTypeCount: 1.5 }]
  ])('answers a bad gateway when GAS answers %s', async (_, body) => {
    vi.mocked(getFromGas).mockResolvedValue(body)

    await expect(getHome()).rejects.toMatchObject({
      message: 'GAS returned an invalid home view',
      output: { statusCode: 502 }
    })
  })

  test('rejects with the error GAS answered', async () => {
    const error = Boom.badGateway()
    vi.mocked(getFromGas).mockRejectedValue(error)

    await expect(getHome()).rejects.toBe(error)
  })
})
