import { getGrantAllowList } from '../repositories/allow-list.repository.ts'
import { getAllowListUseCase } from './get-allow-list.use-case.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

const allowList = {
  adminRole: 'ROLE_WOODLAND_ADMIN',
  grantCode: 'woodland',
  global: { sbi: ['106000033'], crn: ['1042000000'] }
}

describe('getAllowListUseCase', () => {
  beforeEach(() => {
    vi.mocked(getGrantAllowList).mockResolvedValue(allowList)
  })

  test('returns the grant allow list when the caller holds the admin role', async () => {
    await expect(
      getAllowListUseCase('woodland', ['OTHER', 'ROLE_WOODLAND_ADMIN'])
    ).resolves.toEqual(allowList)
    expect(getGrantAllowList).toHaveBeenCalledWith('woodland')
  })

  test.each([
    ['missing cwRoles', undefined],
    ['null cwRoles', null],
    ['empty cwRoles', []],
    ['the wrong role', ['ROLE_WOODLAND_READER']]
  ])('denies access with %s', async (_, cwRoles) => {
    await expect(
      getAllowListUseCase('woodland', cwRoles)
    ).rejects.toMatchObject({ output: { statusCode: 403 } })
  })

  test('denies access when the grant has no configured admin role', async () => {
    vi.mocked(getGrantAllowList).mockResolvedValue({
      ...allowList,
      adminRole: ''
    })

    await expect(
      getAllowListUseCase('woodland', ['ROLE_WOODLAND_ADMIN'])
    ).rejects.toMatchObject({ output: { statusCode: 403 } })
  })
})
