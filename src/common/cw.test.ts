import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { pino } from 'pino'

import { config } from './config.ts'
import { getCwRoles } from './cw.ts'
import { logger } from './logger.ts'

vi.mock(import('./logger.ts'))

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const failureLine = (detail: string) =>
  `Failed to fetch CW roles for user user-1 - claims access will be unavailable this session: ${detail}`

const writtenLog = () => {
  let written = ''
  const real = pino(
    { errorKey: 'error' },
    {
      write: (line: string) => {
        written += line
      }
    }
  )

  real.warn(...(vi.mocked(logger.warn).mock.calls[0] as [string]))

  return written
}

describe('getCwRoles', () => {
  const configured = {
    apiUrl: config.get('cw.apiUrl'),
    serviceToken: config.get('cw.serviceToken'),
    timeoutMs: config.get('cw.timeoutMs')
  }

  let handler: Handler
  let server: Server
  let apiUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res))
    apiUrl = await listen(server)
  })

  beforeEach(() => {
    config.set('cw.apiUrl', apiUrl)
    config.set('cw.serviceToken', 'sentinel-cw-token')
  })

  afterEach(() => {
    config.set('cw.apiUrl', configured.apiUrl)
    config.set('cw.serviceToken', configured.serviceToken)
    config.set('cw.timeoutMs', configured.timeoutMs)
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  test('returns the names of the roles caseworking holds for the user', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          appRoles: [
            { roleName: 'A', from: null, to: null },
            { roleName: 'B', from: '2026-01-01', to: null }
          ]
        })
      )
    }

    await expect(getCwRoles('user-1')).resolves.toEqual(['A', 'B'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('presents the service token and an encoded user id', async () => {
    let seen: IncomingMessage | undefined

    handler = (req, res) => {
      seen = req
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ appRoles: [] }))
    }

    await getCwRoles('tenant/user one')

    expect(seen?.url).toBe(
      `/api/users/${encodeURIComponent('tenant/user one')}/roles`
    )
    expect(seen?.headers.authorization).toBe('Bearer sentinel-cw-token')
  })

  test('logs an upstream failure without the service token', async () => {
    handler = (_req, res) => {
      res.statusCode = 503
      res.end()
    }

    await expect(getCwRoles('user-1')).resolves.toBeNull()

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      failureLine('Error: Response Error: 503 Service Unavailable')
    )
    expect(writtenLog()).not.toContain('sentinel-cw-token')
    expect(writtenLog()).not.toMatch(/authorization/i)
  })

  test('logs an unreadable answer without the service token', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end('<html>')
    }

    await expect(getCwRoles('user-1')).resolves.toBeNull()

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /^Failed to fetch CW roles for user user-1 - claims access will be unavailable this session: Error: Unexpected token/
      )
    )
    expect(writtenLog()).not.toContain('sentinel-cw-token')
    expect(writtenLog()).not.toMatch(/authorization/i)
  })

  test('logs an unreachable backend without the service token', async () => {
    const closed = createServer()
    config.set('cw.apiUrl', await listen(closed))
    await new Promise((resolve) => closed.close(resolve))

    await expect(getCwRoles('user-1')).resolves.toBeNull()

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /: Error: Client request error: connect ECONNREFUSED 127\.0\.0\.1:\d+$/
      )
    )
    expect(writtenLog()).not.toContain('sentinel-cw-token')
    expect(writtenLog()).not.toMatch(/authorization/i)
  })

  test('logs a timeout without the service token', async () => {
    config.set('cw.timeoutMs', 50)
    handler = () => {}

    await expect(getCwRoles('user-1')).resolves.toBeNull()

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      failureLine('Error: Client request timeout')
    )
    expect(writtenLog()).not.toContain('sentinel-cw-token')
    expect(writtenLog()).not.toMatch(/authorization/i)
  })
})
