import { getFromGas, postToGas } from '../../common/gas.ts'
import {
  findApplicationPage,
  searchApplications
} from './applications.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('searchApplications', () => {
  test('posts the search, so a ref never travels in a URL', async () => {
    await searchApplications({ ref: '9d3-5b1-e08', code: 'woodland' }, false)

    expect(postToGas).toHaveBeenCalledWith('/grant-admin/applications/search', {
      payload: { ref: '9d3-5b1-e08', code: 'woodland' }
    })
  })

  test('marks a repeated search as one', async () => {
    await searchApplications({ ref: '9d3-5b1-e08' }, true)

    expect(postToGas).toHaveBeenCalledWith('/grant-admin/applications/search', {
      payload: { ref: '9d3-5b1-e08' },
      headers: { 'x-search-repeat': '1' }
    })
  })
})

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
