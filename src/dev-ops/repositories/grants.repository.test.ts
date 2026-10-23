import { getFromGas, postToGas } from '../../common/gas.ts'
import {
  fetchGrantDefinitions,
  findGrantVersionPage,
  findGrantVersions
} from './grants.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findGrantVersionPage', () => {
  test('reads one read of one grant version', async () => {
    await findGrantVersionPage(
      { code: 'woodland-creation', version: '1.2.0' },
      'definition'
    )

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland-creation/versions/1.2.0/definition'
    )
  })
})

describe('findGrantVersions', () => {
  test("reads every version of a grant's code", async () => {
    await findGrantVersions('woodland-creation')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland-creation/versions'
    )
  })
})

describe('fetchGrantDefinitions', () => {
  test('asks GAS to fetch every file of one grant version, for the operator', async () => {
    vi.mocked(postToGas).mockResolvedValue({
      files: [{ file: 'grant', outcome: 'stored' }]
    })

    await expect(
      fetchGrantDefinitions(
        { code: 'woodland-creation', version: '2.0.0' },
        'Ada Lovelace'
      )
    ).resolves.toEqual({ files: [{ file: 'grant', outcome: 'stored' }] })
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland-creation/versions/2.0.0/fetch',
      { actor: 'Ada Lovelace' }
    )
  })
})
