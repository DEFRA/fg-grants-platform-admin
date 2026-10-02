import { searchCases } from '../repositories/cases.repository.ts'
import type { CasesPage } from '../repositories/cases.repository.ts'
import { searchCasesUseCase } from './search-cases.use-case.ts'

vi.mock(import('../repositories/cases.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const page: CasesPage = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: []
}

describe('searchCasesUseCase', () => {
  test('hands back the page GAS answered with', async () => {
    vi.mocked(searchCases).mockResolvedValue(page)

    await expect(
      searchCasesUseCase({ workflowCode: 'woodland' }, false)
    ).resolves.toEqual({ page, unavailable: false, refused: false })
  })

  test('leaves the list empty when CW is down', async () => {
    vi.mocked(searchCases).mockRejectedValue(
      Object.assign(new Error('Bad Gateway'), { output: { statusCode: 502 } })
    )

    await expect(searchCasesUseCase({}, false)).resolves.toEqual({
      page,
      unavailable: true,
      refused: false
    })
  })
})
