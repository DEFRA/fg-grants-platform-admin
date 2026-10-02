import { getFromGas, postToGas } from '../../common/gas.ts'
import { findCasePage, searchCases } from './cases.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('searchCases', () => {
  test('posts the search to GAS, which reads it from CW', async () => {
    await searchCases({ ref: 'f02-7d8-a61', workflowCode: 'woodland' }, false)

    expect(postToGas).toHaveBeenCalledWith('/grant-admin/cases/search', {
      payload: { ref: 'f02-7d8-a61', workflowCode: 'woodland' }
    })
  })

  test('marks a repeated search as one', async () => {
    await searchCases({ ref: 'f02-7d8-a61' }, true)

    expect(postToGas).toHaveBeenCalledWith('/grant-admin/cases/search', {
      payload: { ref: 'f02-7d8-a61' },
      headers: { 'x-search-repeat': '1' }
    })
  })
})

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
