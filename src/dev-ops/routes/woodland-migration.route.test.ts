import type { Server } from '@hapi/hapi'

import { wreck } from '../../common/wreck.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'

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

describe('woodlandMigrationRoutes', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    vi.stubEnv('GAS_API_URL', 'http://gas.test')
    vi.stubEnv('GAS_SERVICE_TOKEN', '<token>')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await server.stop()
  })

  test.each([
    ['dry-run', '/operations/woodland-migration/dry-run'],
    ['apply', '/operations/woodland-migration/apply']
  ])('redirects an anonymous %s request to login', async (_name, url) => {
    const { statusCode, headers } = await server.inject({ method: 'POST', url })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/auth/login')
    expect(wreck.post).not.toHaveBeenCalled()
  })

  test.each([
    ['dry-run', '/operations/woodland-migration/dry-run'],
    ['apply', '/operations/woodland-migration/apply']
  ])('forbids %s for an applications admin', async (_name, url) => {
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
  })

  test('runs a clean dry-run without a request body and offers apply', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 50,
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
    expect(wreck.post).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(wreck.post).mock.calls[0]
    expect(url).toBe('http://gas.test/admin/migrations/woodland/dry-run')
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer <token>' },
      json: true,
      timeout: 50_000
    })
    expect(Object.prototype.hasOwnProperty.call(options, 'payload')).toBe(false)
    expect(result).toEqual(expect.stringContaining('5274'))
    expect(result).toEqual(expect.stringContaining(checksum))
    expect(result).toEqual(
      expect.stringContaining('action="/operations/woodland-migration/apply"')
    )
    expect(result).toEqual(expect.stringContaining('name="confirmation"'))
  })

  test('shows a failed dry-run without offering apply', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 50,
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
    expect(result).toEqual(expect.stringContaining('5274'))
    expect(result).toEqual(expect.stringContaining('Apply is unavailable'))
    expect(result).not.toEqual(
      expect.stringContaining('action="/operations/woodland-migration/apply"')
    )
  })

  test('shows a controlled GAS error from dry-run', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 502 },
      payload: { message: 'boom' }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/dry-run',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(expect.stringContaining('boom'))
    expect(result).not.toEqual(
      expect.stringContaining('action="/operations/woodland-migration/apply"')
    )
  })

  test('shows a controlled transport error from dry-run', async () => {
    vi.mocked(wreck.post).mockRejectedValue(new Error('ECONNRESET'))

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/dry-run',
      auth: operationsAdminAuth
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(
      expect.stringContaining('Dry-run request to GAS failed.')
    )
  })

  test('applies with the exact checkbox, count, and checksum payload', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        valid: true,
        agreements: 50,
        versions: 5274,
        inserted: 50,
        replaced: 0,
        skipped: 0,
        sourceChecksum: checksum
      }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/apply',
      auth: operationsAdminAuth,
      payload: {
        confirmation: 'APPLY_WOODLAND_MIGRATION',
        expectedAgreements: '50',
        expectedVersions: '5274',
        sourceChecksum: checksum
      }
    })

    expect(statusCode).toBe(200)
    expect(wreck.post).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(wreck.post).mock.calls[0]
    expect(url).toBe('http://gas.test/admin/migrations/woodland/apply')
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer <token>' },
      json: true,
      timeout: 50_000
    })
    expect(options?.payload).toEqual({
      confirmation: 'APPLY_WOODLAND_MIGRATION',
      expectedAgreements: 50,
      expectedVersions: 5274,
      sourceChecksum: checksum
    })
    expect(result).toEqual(expect.stringContaining('Inserted'))
    expect(result).toEqual(expect.stringContaining('50'))
  })

  test('forwards an absent confirmation unchanged', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 400 },
      payload: { message: 'confirmation is required' }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/apply',
      auth: operationsAdminAuth,
      payload: {
        expectedAgreements: '50',
        expectedVersions: '5274',
        sourceChecksum: checksum
      }
    })

    expect(statusCode).toBe(200)
    expect(vi.mocked(wreck.post).mock.calls[0][1]?.payload).toEqual({
      confirmation: undefined,
      expectedAgreements: 50,
      expectedVersions: 5274,
      sourceChecksum: checksum
    })
    expect(result).toEqual(expect.stringContaining('confirmation is required'))
  })

  test('shows an apply GAS error and keeps the apply form available', async () => {
    vi.mocked(wreck.post).mockResolvedValue({
      res: { statusCode: 412 },
      payload: { message: 'confirmation invalid' }
    } as never)

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/apply',
      auth: operationsAdminAuth,
      payload: {
        confirmation: 'wrong',
        expectedAgreements: '50',
        expectedVersions: '5274',
        sourceChecksum: checksum
      }
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(expect.stringContaining('confirmation invalid'))
    expect(result).toEqual(
      expect.stringContaining('action="/operations/woodland-migration/apply"')
    )
    expect(result).toEqual(expect.stringContaining(`value="${checksum}"`))
  })

  test('shows a controlled transport error from apply', async () => {
    vi.mocked(wreck.post).mockRejectedValue(new Error('ECONNRESET'))

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/operations/woodland-migration/apply',
      auth: operationsAdminAuth,
      payload: {
        confirmation: 'APPLY_WOODLAND_MIGRATION',
        expectedAgreements: '50',
        expectedVersions: '5274',
        sourceChecksum: checksum
      }
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual(
      expect.stringContaining('Apply request to GAS failed.')
    )
  })
})
