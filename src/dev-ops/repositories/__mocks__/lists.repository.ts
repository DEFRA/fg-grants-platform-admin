import Boom from '@hapi/boom'

import type { ListAnswer } from '../lists.repository.ts'

/** GAS has no list at any path unless a test says otherwise, as it answers one it hasn't got. */
export const queryList = vi.fn(async (): Promise<ListAnswer> => {
  throw new Boom.Boom('Response Error: 404', {
    statusCode: 404,
    data: {
      isResponseError: true,
      payload: { statusCode: 404, code: 'LIST_NOT_FOUND', shell: null }
    }
  })
})
