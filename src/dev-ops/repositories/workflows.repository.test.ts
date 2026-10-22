import { getFromGas, postToGas } from '../../common/gas.ts'
import {
  fetchWorkflowDefinition,
  findWorkflowVersionPage,
  findWorkflowVersions
} from './workflows.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findWorkflowVersionPage', () => {
  test('reads one read of one workflow version', async () => {
    await findWorkflowVersionPage(
      { code: 'woodland-creation', version: '1.2.0' },
      'raw'
    )

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/workflows/woodland-creation/versions/1.2.0/raw'
    )
  })

  test('escapes the code and version it puts in the path', async () => {
    await findWorkflowVersionPage(
      { code: 'a/b', version: '1.2.0?x' },
      'overview'
    )

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/workflows/a%2Fb/versions/1.2.0%3Fx/overview'
    )
  })
})

describe('findWorkflowVersions', () => {
  test("reads every version of a workflow's code, as CW spells it", async () => {
    await findWorkflowVersions('Casework-Smoke')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/workflows/Casework-Smoke/versions'
    )
  })
})

describe('fetchWorkflowDefinition', () => {
  test('asks GAS to fetch the workflow of one version, for the operator', async () => {
    vi.mocked(postToGas).mockResolvedValue({
      files: [{ file: 'workflow', outcome: 'stored' }]
    })

    await expect(
      fetchWorkflowDefinition(
        { code: 'woodland-creation', version: '2.0.0' },
        'Ada Lovelace'
      )
    ).resolves.toEqual({ files: [{ file: 'workflow', outcome: 'stored' }] })
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/workflows/woodland-creation/versions/2.0.0/fetch',
      { actor: 'Ada Lovelace' }
    )
  })
})
