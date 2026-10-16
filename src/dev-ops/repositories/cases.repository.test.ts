import { getFromGas } from '../../common/gas.ts'
import { findCasePage } from './cases.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findCasePage', () => {
  test('reads one tab of one case', async () => {
    await findCasePage(
      { workflowCode: 'woodland', caseRef: 'f02-7d8-a61' },
      'events'
    )

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/workflows/woodland/cases/f02-7d8-a61/events'
    )
  })
})
