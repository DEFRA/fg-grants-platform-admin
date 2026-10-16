import { getFromGas } from '../../common/gas.ts'
import { findApplicationPage } from './applications.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findApplicationPage', () => {
  test('reads one tab of one application', async () => {
    await findApplicationPage(
      { code: 'frps-private-beta', clientRef: 'a7c-2f1-9e4' },
      'raw'
    )

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/frps-private-beta/applications/a7c-2f1-9e4/raw'
    )
  })
})
