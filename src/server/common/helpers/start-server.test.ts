import { vi } from 'vitest'
import type { Server } from '@hapi/hapi'

import hapi from '@hapi/hapi'
import { statusCodes } from '../constants/status-codes.ts'

describe('#startServer', () => {
  let createServerSpy: ReturnType<typeof vi.spyOn>
  let hapiServerSpy: ReturnType<typeof vi.spyOn>
  let startServerImport: typeof import('./start-server.ts')
  let createServerImport: typeof import('../../server.ts')

  beforeAll(async () => {
    vi.stubEnv('PORT', '3097')

    createServerImport = await import('../../server.ts')
    startServerImport = await import('./start-server.ts')

    createServerSpy = vi.spyOn(createServerImport, 'createServer')
    hapiServerSpy = vi.spyOn(
      hapi as unknown as { server: typeof hapi.server },
      'server'
    )
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  describe('When server starts', () => {
    let server: Server

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('Should start up server as expected', async () => {
      server = await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/health'
      })

      expect(result).toEqual({ message: 'success' })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServerImport.startServer()).rejects.toThrow(
        'Server failed to start'
      )
    })
  })
})
