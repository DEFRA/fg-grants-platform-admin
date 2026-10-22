import { findWorkflowVersions } from '../repositories/workflows.repository.ts'
import { getWorkflowVersionsUseCase } from './get-workflow-versions.use-case.ts'

vi.mock(import('../repositories/workflows.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getWorkflowVersionsUseCase', () => {
  test('hands back the versions GAS answered with', async () => {
    const versions = { code: 'woodland-creation', current: null, versions: [] }
    vi.mocked(findWorkflowVersions).mockResolvedValue(versions)

    await expect(
      getWorkflowVersionsUseCase('woodland-creation')
    ).resolves.toEqual({ outcome: 'found', page: versions })
    expect(findWorkflowVersions).toHaveBeenCalledWith('woodland-creation')
  })

  test("is not found only on GAS's own miss of the workflow", async () => {
    vi.mocked(findWorkflowVersions).mockRejectedValue(
      responseError(404, { reason: 'WORKFLOW_NOT_FOUND' })
    )

    await expect(getWorkflowVersionsUseCase('nope')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test('reads a timeout as an outage', async () => {
    vi.mocked(findWorkflowVersions).mockRejectedValue(responseError(504))

    await expect(
      getWorkflowVersionsUseCase('woodland-creation')
    ).resolves.toEqual({ outcome: 'timed-out', page: null })
  })
})
