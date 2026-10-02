import { findApplicationPage } from '../repositories/applications.repository.ts'
import type { ApplicationPage } from '../repositories/applications.repository.ts'
import { getApplicationPageUseCase } from './get-application-page.use-case.ts'

vi.mock(import('../repositories/applications.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'frps-private-beta', clientRef: 'a7c-2f1-9e4' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getApplicationPageUseCase', () => {
  test('hands back the page GAS answered with', async () => {
    const page = { header: {} } as ApplicationPage
    vi.mocked(findApplicationPage).mockResolvedValue(page)

    await expect(getApplicationPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'found',
      page
    })
  })

  test("is not found only on GAS's own miss", async () => {
    vi.mocked(findApplicationPage).mockRejectedValue(
      responseError(404, { reason: 'APPLICATION_NOT_FOUND' })
    )

    await expect(getApplicationPageUseCase(ref, 'raw')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test.each([
    ['a 404 with no reason, a route GAS has not got', 404, 'unavailable'],
    ['a gateway timeout', 504, 'timed-out'],
    ['any other failure', 500, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findApplicationPage).mockRejectedValue(responseError(status))

    await expect(getApplicationPageUseCase(ref, 'events')).resolves.toEqual({
      outcome,
      page: null
    })
  })
})
