import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import type { WorkflowVersionPage } from '../repositories/workflows.repository.ts'
import { getWorkflowPageUseCase } from './get-workflow-page.use-case.ts'

vi.mock(import('../repositories/workflows.repository.ts'))

const ref = { code: 'woodland-creation', version: '1.2.0' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { isResponseError: true, payload: body }
  })

describe('getWorkflowPageUseCase', () => {
  test.each([
    ['overview', 'overview'],
    ['phases', 'phases'],
    ['tasks', 'definition'],
    ['pages', 'definition'],
    ['integrations', 'definition'],
    ['raw', 'raw']
  ] as const)(
    "reads the %s tab from GAS's %s read alone",
    async (tab, read) => {
      const found = {
        header: {
          files: { workflow: { stored: false, fetchStatus: 'pending' } }
        }
      } as WorkflowVersionPage
      vi.mocked(findWorkflowVersionPage).mockResolvedValue(found)

      await expect(getWorkflowPageUseCase(ref, tab)).resolves.toEqual({
        outcome: 'found',
        page: found
      })
      expect(findWorkflowVersionPage).toHaveBeenCalledWith(ref, read)
      expect(findWorkflowVersionPage).toHaveBeenCalledTimes(1)
    }
  )

  test.each(['overview', 'phases'] as const)(
    "is not found only on GAS's own miss of the version, on %s",
    async (tab) => {
      vi.mocked(findWorkflowVersionPage).mockRejectedValue(
        responseError(404, { reason: 'WORKFLOW_VERSION_NOT_FOUND' })
      )

      await expect(getWorkflowPageUseCase(ref, tab)).resolves.toEqual({
        outcome: 'not-found',
        page: null
      })
    }
  )

  test.each([
    [
      'a 404 with no reason, a route GAS has not got',
      404,
      'unavailable',
      { kind: 'refused', statusCode: 404, errorCode: null }
    ],
    ['a gateway timeout', 504, 'timed-out', { kind: 'timed-out' }],
    [
      'a bad gateway, CW down behind GAS',
      502,
      'unavailable',
      { kind: 'errored', upstream: true }
    ]
  ])('reads %s as an outage', async (_name, status, outcome, failure) => {
    vi.mocked(findWorkflowVersionPage).mockRejectedValue(responseError(status))

    await expect(
      getWorkflowPageUseCase(ref, 'overview')
    ).resolves.toMatchObject({
      outcome,
      page: null,
      failure
    })
  })
})
