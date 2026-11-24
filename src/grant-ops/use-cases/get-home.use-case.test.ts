import Boom from '@hapi/boom'

import { logger } from '../../common/logger.ts'
import { getHome } from '../repositories/home.repository.ts'
import { getHomeUseCase } from './get-home.use-case.ts'

vi.mock(import('../repositories/home.repository.ts'))
vi.mock(import('../../common/logger.ts'))

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

/** As @hapi/wreck rejects when no connection could be made. */
const connectionError = () =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  )

describe('getHomeUseCase', () => {
  test('answers the grant type count GAS read', async () => {
    vi.mocked(getHome).mockResolvedValue({ grantTypeCount: 4 })

    expect(await getHomeUseCase()).toEqual({ grantTypeCount: 4 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  test.each([
    ['GAS fails', responseError(500)],
    [
      'GAS cannot determine the roles',
      responseError(503, { errorCode: 'CASEWORKING_ROLES_UNAVAILABLE' })
    ],
    [
      'GAS answers an invalid view',
      Boom.badGateway('GAS returned an invalid home view')
    ],
    ['GAS cannot be reached', connectionError()]
  ])('answers no count and logs when %s', async (_, error) => {
    vi.mocked(getHome).mockRejectedValue(error)

    expect(await getHomeUseCase()).toEqual({ grantTypeCount: null })
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        'Could not read the grant type count from fg-gas-backend'
      )
    )
  })

  test('does not log what GAS answered', async () => {
    vi.mocked(getHome).mockRejectedValue(
      responseError(500, { message: 'SECRET-GAS-BODY' })
    )

    await getHomeUseCase()

    const [line] = vi.mocked(logger.error).mock.calls[0]
    expect(String(line)).not.toContain('SECRET-GAS-BODY')
  })
})
