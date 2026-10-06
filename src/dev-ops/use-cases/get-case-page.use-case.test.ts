import { findCasePage } from '../repositories/cases.repository.ts'
import type { CasePage } from '../repositories/cases.repository.ts'
import { getCasePageUseCase } from './get-case-page.use-case.ts'

vi.mock(import('../repositories/cases.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { workflowCode: 'woodland', caseRef: 'f02-7d8-a61' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getCasePageUseCase', () => {
  test('hands back the page GAS answered with', async () => {
    const page = { header: {} } as CasePage
    vi.mocked(findCasePage).mockResolvedValue(page)

    await expect(getCasePageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'found',
      page
    })
  })

  test("is not found only on CW's own miss, passed through GAS", async () => {
    vi.mocked(findCasePage).mockRejectedValue(
      responseError(404, { reason: 'CASE_NOT_FOUND' })
    )

    await expect(getCasePageUseCase(ref, 'raw')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test.each([
    ['CW timing out', 504, 'timed-out'],
    ['CW down', 502, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findCasePage).mockRejectedValue(responseError(status))

    await expect(getCasePageUseCase(ref, 'events')).resolves.toEqual({
      outcome,
      page: null
    })
  })
})
