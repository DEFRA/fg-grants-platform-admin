import Hapi from '@hapi/hapi'
import type { Request, Server } from '@hapi/hapi'

import {
  countUpstream,
  currentUpstream,
  guardOneCall,
  setExtraCallsHandler
} from './upstream.ts'

/** What a GAS call does to the store: gas.ts's part, without GAS. */
const call = () => {
  const upstream = currentUpstream()

  if (upstream) {
    upstream.calls += 1
  }
}

const counted = (request: Request) => request.app.upstream?.calls ?? null

let server: Server

const warn = vi.fn()

beforeAll(async () => {
  server = Hapi.server()
  // hapi-pino's request logger, which this bare server has not got.
  server.ext('onRequest', (request, h) => {
    Object.assign(request, { logger: { warn } })

    return h.continue
  })
  server.ext('onPreResponse', guardOneCall)
  server.route(
    countUpstream([
      {
        method: 'GET',
        path: '/one',
        handler: async (request: Request) => {
          await Promise.resolve()
          call()

          return { calls: counted(request) }
        }
      },
      {
        method: 'GET',
        path: '/twice',
        handler: (request: Request) => {
          call()
          call()

          return { calls: counted(request) }
        }
      }
    ])
  )
  await server.initialize()
})

afterEach(() => {
  setExtraCallsHandler(null)
})

afterAll(async () => {
  await server.stop()
})

const get = (url: string) => server.inject({ method: 'GET', url })

describe('countUpstream', () => {
  test('counts the calls a handler makes against its request', async () => {
    const { result } = await get('/one')

    expect(result).toEqual({ calls: 1 })
  })

  test('counts nothing outside a request', () => {
    expect(currentUpstream()).toBeNull()
  })
})

describe('guardOneCall', () => {
  test('warns with the route’s method and path pattern when a request made a second call', async () => {
    await get('/twice?ref=GLD-9B2')

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'GET /twice made more than one call to fg-gas-backend'
    )
  })

  test('says nothing of a request that made one', async () => {
    await get('/one')

    expect(warn).not.toHaveBeenCalled()
  })

  test('hands the route to a handler swapped in', async () => {
    const handler = vi.fn()
    setExtraCallsHandler(handler)

    await get('/twice')

    expect(handler).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '/twice' }),
      'GET /twice'
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
