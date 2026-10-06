import { logger } from '../../common/logger.ts'
import { searchApplications } from '../repositories/applications.repository.ts'
import type { ApplicationsPage } from '../repositories/applications.repository.ts'
import { searchApplicationsUseCase } from './search-applications.use-case.ts'

vi.mock(import('../repositories/applications.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const responseError = (statusCode: number) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode }
  })

const page: ApplicationsPage = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  total: { count: 0, capped: false },
  codes: [],
  sourceErrors: []
}

describe('searchApplicationsUseCase', () => {
  test('hands back the page GAS answered with', async () => {
    vi.mocked(searchApplications).mockResolvedValue(page)

    await expect(
      searchApplicationsUseCase({ code: 'woodland' }, true)
    ).resolves.toEqual({ page, unavailable: false, refused: false })
    expect(searchApplications).toHaveBeenCalledWith({ code: 'woodland' }, true)
  })

  test('says the list is unavailable when GAS could not answer', async () => {
    vi.mocked(searchApplications).mockRejectedValue(responseError(502))

    const result = await searchApplicationsUseCase({}, false)

    expect(result.unavailable).toBe(true)
    expect(result.refused).toBe(false)
    expect(result.page.rows).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  test('says the link was refused on a 400', async () => {
    vi.mocked(searchApplications).mockRejectedValue(responseError(400))

    const result = await searchApplicationsUseCase({ cursor: 'junk' }, false)

    expect(result.refused).toBe(true)
    expect(result.unavailable).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })
})
