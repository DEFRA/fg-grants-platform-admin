import { getFromGas } from '../../common/gas.ts'
import { findGrantVersionPage, findGrantVersions } from './grants.repository.ts'

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
