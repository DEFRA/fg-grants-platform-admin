import type { Server } from '@hapi/hapi'

import { wreck } from '../../common/wreck.ts'
import { createServer } from '../../server/index.ts'
import { operations } from '../index.ts'

vi.mock(import('../../common/wreck.ts'), () => ({
  wreck: { post: vi.fn() } as unknown as typeof wreck
}))

const checksum = `sha256:${'0'.repeat(64)}`
const operationsAdminAuth = {
  strategy: 'session',
  credentials: {
    user: { name: 'Ada Lovelace' },
    scope: ['FCP.GrantOperationsAdmin']
  }
}

const migrationPaths = [
  ['dry-run', '/operations/woodland-migration/dry-run'],
  ['catch-up', '/operations/woodland-migration/catch-up']
] as const

describe('woodlandMigrationRoutes', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.register([operations])
    await server.initialize()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GAS_API_URL', 'http://gas.test')
    vi.stubEnv('GAS_SERVICE_TOKEN', '<token>')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await server.stop()
  })

  test.each(migrationPaths)(
    'redirects an anonymous %s request to login',
    async (_name, url) => {
      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/auth/login')
      expect(wreck.post).not.toHaveBeenCalled()
    }
  )

  test.each(migrationPaths)(
    'forbids %s for an applications admin',
    async (_name, url) => {
      const { statusCode } = await server.inject({
        method: 'POST',
        url,
        auth: {
          strategy: 'session',
          credentials: {
            user: { name: 'Ada Lovelace' },
            scope: ['FCP.GrantApplicationsAdmin']
          }
        }
      })

      expect(statusCode).toBe(403)
      expect(wreck.post).not.toHaveBeenCalled()
    }
  )

  test('runs a clean dry-run and offers catch-up rather than apply', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 50,
        offeredAgreements: 12,
        acceptedAgreements: 38,
        versions: 5274,
        failures: 0,
        sourceChecksum: checksum
      }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/dry-run',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(wreck.post).toHaveBeenCalledWith(
      'http://gas.test/admin/migrations/woodland/dry-run',
      expect.objectContaining({
        headers: { Authorization: 'Bearer <token>' },
        json: true,
        timeout: 50_000
      })
    )
    const options = vi.mocked(wreck.post).mock.calls[0][1]
    expect(Object.prototype.hasOwnProperty.call(options, 'payload')).toBe(false)
    expect(result).toEqual(expect.stringContaining('5274'))
    expect(result).toEqual(expect.stringContaining(checksum))
    expect(result).toEqual(expect.stringContaining('Offered agreements'))
    expect(result).toEqual(
      expect.stringContaining(
        'action="/operations/woodland-migration/catch-up"'
      )
    )
    expect(result).not.toEqual(
      expect.stringContaining('action="/operations/woodland-migration/apply"')
    )
    expect(result).not.toEqual(expect.stringContaining('name="confirmation"'))
  })

  test('does not offer catch-up when the dry-run is not clean', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: false,
        agreements: 50,
        offeredAgreements: 12,
        acceptedAgreements: 38,
        versions: 5274,
        failures: 3,
        sourceChecksum: checksum
      }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/dry-run',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(
      expect.stringContaining(
        'The dry-run is not clean. Catch-up is unavailable.'
      )
    )
    expect(result).not.toEqual(
      expect.stringContaining(
        'action="/operations/woodland-migration/catch-up"'
      )
    )
  })

  test('runs catch-up without a request body and shows the result', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 50,
        offeredAgreements: 12,
        acceptedAgreements: 38,
        versions: 5274,
        inserted: 10,
        updated: 4,
        preserved: 36,
        failed: 0,
        failures: [],
        sourceChecksum: checksum
      }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/catch-up',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(wreck.post).toHaveBeenCalledWith(
      'http://gas.test/admin/migrations/woodland/catch-up',
      expect.objectContaining({
        headers: { Authorization: 'Bearer <token>' },
        json: true,
        timeout: 50_000
      })
    )
    const options = vi.mocked(wreck.post).mock.calls[0][1]
    expect(Object.prototype.hasOwnProperty.call(options, 'payload')).toBe(false)
    expect(result).toEqual(expect.stringContaining('Catch-up result'))
    expect(result).toEqual(expect.stringContaining('Preserved'))
    expect(result).toEqual(expect.stringContaining('No failures.'))
  })

  test('lists catch-up failures as agreement number and reason', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 1,
        offeredAgreements: 0,
        acceptedAgreements: 1,
        versions: 2,
        inserted: 0,
        updated: 0,
        preserved: 0,
        failed: 1,
        failures: [
          { agreementNumber: 'WMP00123456', reason: 'identity.mismatch' }
        ],
        sourceChecksum: checksum
      }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/catch-up',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(expect.stringContaining('WMP00123456'))
    expect(result).toEqual(expect.stringContaining('identity.mismatch'))
    expect(result).toEqual(expect.stringContaining('Failures to inspect'))
    expect(result).not.toEqual(
      expect.stringContaining('Do not simply re-run it')
    )
  })

  test.each(migrationPaths)(
    'shows a controlled GAS error from %s',
    async (_name, url) => {
      vi.mocked(wreck.post).mockResolvedValue({
        res: { statusCode: 502 },
        payload: { message: 'boom' }
      } as never)

      const { result, statusCode } = await server.inject({
        method: 'POST',
        url,
        auth: operationsAdminAuth
      })

      expect(statusCode).toBe(200)
      expect(result).toEqual(expect.stringContaining('boom'))
    }
  )

  test.each([
    [
      'dry-run',
      '/operations/woodland-migration/dry-run',
      'Dry-run request to GAS failed.'
    ],
    [
      'catch-up',
      '/operations/woodland-migration/catch-up',
      'Catch-up request to GAS failed.'
    ]
  ])(
    'shows a controlled transport error from %s',
    async (_name, url, message) => {
      vi.mocked(wreck.post).mockRejectedValue(new Error('ECONNRESET'))

      const { result, statusCode } = await server.inject({
        method: 'POST',
        url,
        auth: operationsAdminAuth
      })

      expect(statusCode).toBe(200)
      expect(result).toEqual(expect.stringContaining(message))
    }
  )

  test('removes the obsolete apply route', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/apply',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(404)
    expect(wreck.post).not.toHaveBeenCalled()
  })
})
