import { postToGas } from '../../common/gas.ts'
import { queryList } from './lists.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('queryList', () => {
  test('posts the list’s path, params and search, so a ref never travels in a URL', async () => {
    const ask = {
      path: 'events/gas/outbox',
      params: { status: ['DEAD_LETTER', 'FAILED'] },
      search: 'ref:abc-123-xyz',
      pages: 3,
      repeat: true
    }

    await queryList(ask)

    expect(postToGas).toHaveBeenCalledExactlyOnceWith(
      '/grant-admin/lists/query',
      { payload: ask }
    )
  })
})
