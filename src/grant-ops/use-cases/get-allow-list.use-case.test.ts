import type { AllowListView } from '../repositories/allow-list.repository.ts'
import { getGrantAllowList } from '../repositories/allow-list.repository.ts'
import { getAllowListUseCase } from './get-allow-list.use-case.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

describe('getAllowListUseCase', () => {
  test('returns the allow-list view from its repository', async () => {
    const view: AllowListView = {
      sbi: {
        key: 'sbi',
        label: 'Single Business Identifiers (SBIs)',
        value: '900000002',
        hint: 'One per line. 1 listed.'
      },
      crn: {
        key: 'crn',
        label: 'Customer Reference Numbers (CRNs)',
        value: '9000000001',
        hint: 'One per line. 1 listed.'
      },
      errorSummary: []
    }
    vi.mocked(getGrantAllowList).mockResolvedValue(view)

    await expect(getAllowListUseCase('woodland')).resolves.toEqual(view)
    expect(getGrantAllowList).toHaveBeenCalledWith('woodland')
  })
})
