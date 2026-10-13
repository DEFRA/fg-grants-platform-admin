import { getFromGas, putToGas } from '../../common/gas.ts'
import {
  getGrantAllowList,
  replaceGrantAllowList
} from './allow-list.repository.ts'

vi.mock(import('../../common/gas.ts'))

const allowList = {
  adminRole: 'ROLE_WOODLAND_ADMIN',
  grantCode: 'woodland',
  global: {
    sbi: ['106000033'],
    crn: ['1042000000']
  }
}

describe('getGrantAllowList', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(allowList)
  })

  test('returns the allow list from GAS', async () => {
    await expect(getGrantAllowList('woodland')).resolves.toEqual(allowList)
  })

  test('calls the allow-list endpoint', async () => {
    await getGrantAllowList('woodland')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list'
    )
  })

  test('escapes the grant code as one path segment', async () => {
    await getGrantAllowList('woodland/../admin')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/allow-list'
    )
  })
})

describe('replaceGrantAllowList', () => {
  beforeEach(() => {
    vi.mocked(putToGas).mockResolvedValue(allowList)
  })

  test('returns the canonical allow list from GAS', async () => {
    await expect(
      replaceGrantAllowList('woodland', allowList.global)
    ).resolves.toEqual(allowList)
  })

  test('replaces the global allow list', async () => {
    await replaceGrantAllowList('woodland', allowList.global)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list',
      { payload: { global: allowList.global } }
    )
  })

  test('escapes the grant code as one path segment', async () => {
    await replaceGrantAllowList('woodland/../admin', allowList.global)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/allow-list',
      expect.anything()
    )
  })

  test('sends an empty replacement rather than omitting it', async () => {
    const global = { sbi: [], crn: [] }

    await replaceGrantAllowList('woodland', global)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list',
      { payload: { global } }
    )
  })
})
