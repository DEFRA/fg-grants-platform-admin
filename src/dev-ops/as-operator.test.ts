import type { Server } from '@hapi/hapi'

import { currentGasActor } from '../common/gas-actor.ts'
import { createServer } from '../server/index.ts'
import { asOperator } from './as-operator.ts'

vi.mock(import('../common/config.ts'))

describe('asOperator', () => {
  let server: Server
  let releaseSlow: (() => void) | undefined

  beforeAll(async () => {
    server = await createServer()
    server.route(
      asOperator([
        {
          method: 'GET',
          path: '/as-operator',
          options: { auth: { strategy: 'session' } },
          handler: async () => {
            await Promise.resolve()

            return currentGasActor()
          }
        },
        {
          method: 'GET',
          path: '/as-operator/slow',
          options: { auth: { strategy: 'session' } },
          handler: async () => {
            await new Promise<void>((resolve) => {
              releaseSlow = resolve
            })

            return currentGasActor()
          }
        }
      ])
    )
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('runs the handler as the signed in operator', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/as-operator',
      auth: {
        strategy: 'session',
        credentials: {
          user: {
            id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
            name: 'Ada Lovelace',
            email: 'ada@example.com'
          }
        }
      }
    })

    expect(result).toEqual({
      name: 'Ada Lovelace',
      id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
    })
  })

  test('leaves the id out when the session has none', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/as-operator',
      auth: {
        strategy: 'session',
        credentials: { user: { name: 'Ada Lovelace' } }
      }
    })

    expect(result).toEqual({ name: 'Ada Lovelace', id: undefined })
  })

  const as = (id: string, name: string, url: string) =>
    server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials: { user: { id, name } } }
    })

  test('keeps each of two requests in flight at once to its own operator', async () => {
    const ada = '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
    const grace = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

    const slow = as(ada, 'Ada Lovelace', '/as-operator/slow')
    await new Promise((resolve) => setImmediate(resolve))
    const quick = await as(grace, 'Grace Hopper', '/as-operator')
    releaseSlow?.()

    expect(quick.result).toEqual({ name: 'Grace Hopper', id: grace })
    expect((await slow).result).toEqual({ name: 'Ada Lovelace', id: ada })
  })

  test('names nobody outside the handler it ran for', async () => {
    await as(
      '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
      'Ada',
      '/as-operator/later'
    )

    expect(currentGasActor()).toEqual({})
  })
})
