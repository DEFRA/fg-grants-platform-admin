import hapi from '@hapi/hapi'
import connect from '@defra/hapi-connect'
import { createServer as createViteServer } from 'vite'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { files } from './files.ts'

const viteMiddlewares = vi.fn()

vi.mock(import('vite'), () => ({
  createServer: vi.fn(async () => ({ middlewares: viteMiddlewares }) as never)
}))

vi.mock(import('@defra/hapi-connect'), () => ({
  default: { name: 'hapi-connect', register: vi.fn() }
}))

vi.mock(import('../../common/config.ts'))

describe('files', () => {
  let server: Server

  beforeEach(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterEach(async () => {
    await server.stop()
  })

  test('serves the favicon', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/favicon.ico'
    })

    expect(statusCode).toBe(statusCodes.noContent)
  })

  test('serves a built asset from the public directory', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/public/absent-asset.js'
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(createViteServer).not.toHaveBeenCalled()
  })
})

describe('files in development', () => {
  beforeEach(() => {
    config.set('isProduction', false)
    config.set('isTest', false)
  })

  test('hands the public path to vite, so an edited asset is rebuilt on request', async () => {
    const server = hapi.server()

    await server.register(files)

    expect(createViteServer).toHaveBeenCalledWith({
      server: { middlewareMode: true },
      appType: 'custom'
    })

    expect(vi.mocked(connect.register)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        path: '/public',
        middleware: [viteMiddlewares]
      })
    )

    await server.stop()
  })
})
