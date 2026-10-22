import { logger } from '../../common/logger.ts'
import { fetchWorkflowDefinition } from '../repositories/workflows.repository.ts'
import { fetchWorkflowDefinitionUseCase } from './fetch-workflow-definition.use-case.ts'

vi.mock(import('../repositories/workflows.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'woodland-creation', version: '2.0.0' }

const responseError = (statusCode: number) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: {}, res: {} }
  })

describe('fetchWorkflowDefinitionUseCase', () => {
  test("asks GAS to fetch the version the caller named, for the operator, and reports GAS's answer", async () => {
    const files = [
      {
        file: 'workflow',
        outcome: 'failed',
        reason: 'invalid',
        message: 'phases[0].code is required'
      }
    ] as const
    vi.mocked(fetchWorkflowDefinition).mockResolvedValue({ files: [...files] })

    await expect(
      fetchWorkflowDefinitionUseCase(ref, 'Ada Lovelace')
    ).resolves.toEqual({ outcome: 'fetched', files })
    expect(fetchWorkflowDefinition).toHaveBeenCalledWith(ref, 'Ada Lovelace')
  })

  test('names the workflow version when GAS no longer has it', async () => {
    vi.mocked(fetchWorkflowDefinition).mockRejectedValue(responseError(404))

    await expect(fetchWorkflowDefinitionUseCase(ref)).resolves.toEqual({
      outcome: 'not-found',
      files: []
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Did not fetch workflow woodland-creation@2.0.0: not-found'
    )
  })

  test('reports CW down behind GAS as unavailable', async () => {
    vi.mocked(fetchWorkflowDefinition).mockRejectedValue(responseError(502))

    await expect(fetchWorkflowDefinitionUseCase(ref)).resolves.toEqual({
      outcome: 'unavailable',
      files: []
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Could not fetch workflow woodland-creation@2.0.0 in fg-gas-backend: '
      )
    )
  })
})
