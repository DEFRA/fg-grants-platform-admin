import { getGrantAllowList } from '../repositories/allow-list.repository.ts'
import { getAllowListUseCase } from './get-allow-list.use-case.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

describe('getAllowListUseCase', () => {
  test('returns the grant allow list from its repository', async () => {
    const allowList = {
      adminRole: 'ROLE_WOODLAND_ADMIN',
      grantCode: 'woodland',
      global: { sbi: ['106000033'], crn: ['1042000000'] }
    }
    vi.mocked(getGrantAllowList).mockResolvedValue(allowList)

    await expect(getAllowListUseCase('woodland')).resolves.toEqual(allowList)
    expect(getGrantAllowList).toHaveBeenCalledWith('woodland')
  })
})
