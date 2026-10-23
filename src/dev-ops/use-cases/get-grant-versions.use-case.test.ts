import { findGrantVersions } from '../repositories/grants.repository.ts'
import { getGrantVersionsUseCase } from './get-grant-versions.use-case.ts'

vi.mock(import('../repositories/grants.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getGrantVersionsUseCase', () => {
  test('hands back the versions GAS answered with', async () => {
    const versions = { code: 'woodland-creation', current: null, versions: [] }
    vi.mocked(findGrantVersions).mockResolvedValue(versions)

    await expect(getGrantVersionsUseCase('woodland-creation')).resolves.toEqual(
      { outcome: 'found', page: versions }
    )
    expect(findGrantVersions).toHaveBeenCalledWith('woodland-creation')
  })

  test("is not found only on GAS's own miss of the grant", async () => {
    vi.mocked(findGrantVersions).mockRejectedValue(
      responseError(404, { reason: 'GRANT_NOT_FOUND' })
    )

    await expect(getGrantVersionsUseCase('nope')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test('reads a timeout as an outage', async () => {
    vi.mocked(findGrantVersions).mockRejectedValue(responseError(504))

    await expect(getGrantVersionsUseCase('woodland-creation')).resolves.toEqual(
      { outcome: 'timed-out', page: null }
    )
  })
})
