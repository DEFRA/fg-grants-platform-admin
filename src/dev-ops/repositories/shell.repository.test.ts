import { getFromGas } from '../../common/gas.ts'
import { findShell } from './shell.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findShell', () => {
  test('reads the shell alone from fg-gas-backend', async () => {
    const shell = { catalogue: { buckets: [], sourceErrors: [] } }
    vi.mocked(getFromGas).mockResolvedValue({ shell })

    await expect(findShell()).resolves.toEqual(shell)
    expect(getFromGas).toHaveBeenCalledExactlyOnceWith('/grant-admin/shell')
  })
})
