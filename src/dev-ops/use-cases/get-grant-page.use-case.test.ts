import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import type { GrantVersionPage } from '../repositories/grants.repository.ts'
import { getGrantPageUseCase } from './get-grant-page.use-case.ts'

vi.mock(import('../repositories/grants.repository.ts'))
vi.mock(import('../../common/logger.ts'))
vi.mock(import('./grant-tabs.ts'), async (importOriginal) => {
  const { grantTabs } = await importOriginal()

  return {
    grantTabs: {
      ...grantTabs,
      // A tab for a file a version may not have, as Agreement and Payment are.
      payment: { read: 'payment', file: 'payment' }
    } as typeof grantTabs
  }
})

const ref = { code: 'woodland-creation', version: '1.2.0' }

const page = (files: object): GrantVersionPage =>
  ({ header: { files } }) as GrantVersionPage

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getGrantPageUseCase', () => {
  test.each([
    ['overview', 'overview'],
    ['actions', 'definition'],
    ['raw', 'definition']
  ] as const)("reads the %s tab from GAS's %s read", async (tab, read) => {
    const found = page({ grant: { stored: true, fetchStatus: 'fetched' } })
    vi.mocked(findGrantVersionPage).mockResolvedValue(found)

    await expect(getGrantPageUseCase(ref, tab)).resolves.toEqual({
      outcome: 'found',
      page: found
    })
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, read)
  })

  test('hides a tab for a file the version has not got', async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      page({ grant: { stored: true, fetchStatus: 'fetched' } })
    )

    await expect(getGrantPageUseCase(ref, 'payment' as 'raw')).resolves.toEqual(
      { outcome: 'hidden', page: null }
    )
  })

  test('shows a tab for a file the version has, stored or not', async () => {
    const found = page({
      grant: { stored: true, fetchStatus: 'fetched' },
      payment: { stored: false, fetchStatus: 'pending' }
    })
    vi.mocked(findGrantVersionPage).mockResolvedValue(found)

    await expect(getGrantPageUseCase(ref, 'payment' as 'raw')).resolves.toEqual(
      { outcome: 'found', page: found }
    )
  })

  test("is not found only on GAS's own miss of the version", async () => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(
      responseError(404, { reason: 'GRANT_VERSION_NOT_FOUND' })
    )

    await expect(getGrantPageUseCase(ref, 'raw')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test.each([
    ['a 404 with no reason, a route GAS has not got', 404, 'unavailable'],
    ['a gateway timeout', 504, 'timed-out'],
    ['any other failure', 500, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(responseError(status))

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome,
      page: null
    })
  })
})
