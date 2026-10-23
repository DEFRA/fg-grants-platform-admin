import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import type { WorkflowVersionPage } from '../repositories/workflows.repository.ts'
import { getWorkflowPageUseCase } from './get-workflow-page.use-case.ts'
import { readGrantStatusMap } from './grant-status-map.ts'
import type { GrantStatusMap } from './grant-status-map.ts'
import { woodlandDefinition } from './test-fixtures.ts'

vi.mock(import('../repositories/workflows.repository.ts'))
vi.mock(import('./grant-status-map.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'woodland-creation', version: '1.2.0' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

const stored = {
  header: { files: { workflow: { stored: true, fetchStatus: 'fetched' } } },
  definition: woodlandDefinition,
  sourceErrors: [],
  sectionErrors: []
} as unknown as WorkflowVersionPage
const grant: GrantStatusMap = { outcome: 'no-grant' }

describe('getWorkflowPageUseCase', () => {
  beforeEach(() => {
    vi.mocked(readGrantStatusMap).mockResolvedValue(grant)
  })

  test.each([
    ['overview', 'overview'],
    ['phases', 'definition'],
    ['pages', 'definition'],
    ['events', 'events'],
    ['raw', 'raw']
  ] as const)("reads the %s tab from GAS's %s read", async (tab, read) => {
    const found = {
      header: { files: { workflow: { stored: false, fetchStatus: 'pending' } } }
    } as WorkflowVersionPage
    vi.mocked(findWorkflowVersionPage).mockResolvedValue(found)

    await expect(getWorkflowPageUseCase(ref, tab)).resolves.toEqual({
      outcome: 'found',
      page: found
    })
    expect(findWorkflowVersionPage).toHaveBeenCalledWith(ref, read)
  })

  test("is not found only on GAS's own miss of the version", async () => {
    vi.mocked(findWorkflowVersionPage).mockRejectedValue(
      responseError(404, { reason: 'WORKFLOW_VERSION_NOT_FOUND' })
    )

    await expect(getWorkflowPageUseCase(ref, 'raw')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test.each([
    ['a 404 with no reason, a route GAS has not got', 404, 'unavailable'],
    ['a gateway timeout', 504, 'timed-out'],
    ['a bad gateway, CW down behind GAS', 502, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findWorkflowVersionPage).mockRejectedValue(responseError(status))

    await expect(getWorkflowPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome,
      page: null
    })
  })

  test('reads the workflow, then the grant of the same code and version', async () => {
    vi.mocked(findWorkflowVersionPage).mockResolvedValue(stored)

    await expect(getWorkflowPageUseCase(ref, 'phases')).resolves.toEqual({
      outcome: 'found',
      page: { ...stored, grantStatusMap: grant }
    })
    expect(readGrantStatusMap).toHaveBeenCalledWith(ref)
    expect(
      vi.mocked(findWorkflowVersionPage).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(readGrantStatusMap).mock.invocationCallOrder[0])
  })

  test('keeps the page when the grant cannot be read', async () => {
    vi.mocked(findWorkflowVersionPage).mockResolvedValue(stored)
    vi.mocked(readGrantStatusMap).mockResolvedValue({
      outcome: 'unavailable'
    })

    await expect(getWorkflowPageUseCase(ref, 'phases')).resolves.toEqual({
      outcome: 'found',
      page: { ...stored, grantStatusMap: { outcome: 'unavailable' } }
    })
  })

  test('reads no grant while the workflow is not stored or too large', async () => {
    const notShown = { ...stored, definition: null }
    vi.mocked(findWorkflowVersionPage).mockResolvedValue(notShown)

    await expect(getWorkflowPageUseCase(ref, 'phases')).resolves.toEqual({
      outcome: 'found',
      page: notShown
    })
    expect(readGrantStatusMap).not.toHaveBeenCalled()
  })

  test.each([
    ['missing', responseError(404, { reason: 'WORKFLOW_VERSION_NOT_FOUND' })],
    ['timed out', responseError(504)],
    ['unavailable', responseError(502)]
  ])('reads no grant when the workflow is %s', async (_name, error) => {
    vi.mocked(findWorkflowVersionPage).mockRejectedValue(error)

    await getWorkflowPageUseCase(ref, 'phases')

    expect(readGrantStatusMap).not.toHaveBeenCalled()
  })

  test.each(['overview', 'pages', 'raw'] as const)(
    'reads no grant on %s',
    async (tab) => {
      vi.mocked(findWorkflowVersionPage).mockResolvedValue(stored)

      await getWorkflowPageUseCase(ref, tab)

      expect(readGrantStatusMap).not.toHaveBeenCalled()
    }
  )
})
