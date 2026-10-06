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
      searchCasesUseCase({ code: 'woodland' }, false)
    ).resolves.toEqual({ page, unavailable: false, refused: false })
  })

  test('asks GAS for the chosen code as its workflow code', async () => {
    vi.mocked(searchCases).mockResolvedValue(page)

    await searchCasesUseCase({ code: 'woodland', ref: 'f02-7d8-a61' }, true)

    expect(searchCases).toHaveBeenCalledWith(
      { workflowCode: 'woodland', ref: 'f02-7d8-a61' },
      true
    )
  })

  test('asks GAS for every workflow when no code is chosen', async () => {
    vi.mocked(searchCases).mockResolvedValue(page)

    await searchCasesUseCase({ cursor: 'NEXT' }, false)

    expect(searchCases).toHaveBeenCalledWith({ cursor: 'NEXT' }, false)
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
