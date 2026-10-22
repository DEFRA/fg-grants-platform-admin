import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import type {
  GrantLifecycle,
  GrantVersionPage
} from '../repositories/grants.repository.ts'
import { readGrantStatusMap } from './grant-status-map.ts'

vi.mock(import('../repositories/grants.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'woodland-creation', version: '1.2.0' }

const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: null,
      stages: [{ code: 'REVIEW', name: null, statuses: [{ code: 'APPROVED' }] }]
    }
  ],
  initialPosition: 'PRE_AWARD:REVIEW:APPROVED',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:APPROVED',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::APPROVED',
      to: 'PRE_AWARD:REVIEW:APPROVED'
    }
  ],
  claimApproval: null
}

const answer = (overrides: Partial<GrantVersionPage> = {}): GrantVersionPage =>
  ({
    header: { files: { grant: { stored: true, fetchStatus: 'fetched' } } },
    lifecycle,
    problem: null,
    sourceErrors: [],
    sectionErrors: [],
    ...overrides
  }) as GrantVersionPage

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('readGrantStatusMap', () => {
  test("reads the lifecycle from the grant's phases read", async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(answer())

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'found',
      lifecycle
    })
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, 'phases')
  })

  test('finds a grant with no mappings, as GAS reads one with no externalStatusMap', async () => {
    const unmapped = { ...lifecycle, externalMappings: [] }
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      answer({ lifecycle: unmapped })
    )

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'found',
      lifecycle: unmapped
    })
  })

  test('is unreadable when GAS cannot describe the stored grant', async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      answer({
        lifecycle: null,
        problem: 'externalStatusMap.phases is required'
      })
    )

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'unreadable'
    })
  })

  test('is not stored while the grant file is not stored', async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      answer({
        header: {
          files: { grant: { stored: false, fetchStatus: 'pending' } }
        } as GrantVersionPage['header'],
        lifecycle: null
      })
    )

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'not-stored'
    })
  })

  test('is unavailable when the phases section failed', async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      answer({
        lifecycle: null,
        sectionErrors: [{ section: 'phases', message: 'read failed' }]
      })
    )

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'unavailable'
    })
  })

  test("is no grant on GAS's own miss of the version", async () => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(
      responseError(404, { reason: 'GRANT_VERSION_NOT_FOUND' })
    )

    await expect(readGrantStatusMap(ref)).resolves.toEqual({
      outcome: 'no-grant'
    })
  })

  test.each([
    ['a 404 with no reason', 404, 'unavailable'],
    ['a gateway timeout', 504, 'timed-out'],
    ['a server error', 500, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(responseError(status))

    await expect(readGrantStatusMap(ref)).resolves.toEqual({ outcome })
  })
})
