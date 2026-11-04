import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, Server } from '@hapi/hapi'

import { catchAll } from './errors.ts'
import { createServer } from '../index.ts'
import { statusCodes } from '../../common/status-codes.ts'

describe('errors', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()

    // Raised directly: the page is under test, not the scope check.
    server.route({
      method: 'GET',
      path: '/refused',
      options: { auth: false },
      handler() {
        throw Boom.forbidden('Insufficient scope')
      }
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('renders the not found page for an unknown path', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/non-existent-path'
    })

    expect(result).toEqual(
      expect.stringContaining('Page not found | Grants Platform Administration')
    )
    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('renders the refusal page for a forbidden request', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/refused'
    })

    expect(result).toEqual(
      expect.stringContaining(
        'You do not have access to this part of the service'
      )
    )
    expect(result).toEqual(expect.stringContaining('contact your line manager'))
    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('keeps the reason for a refusal off the page', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/refused'
    })

    expect(result).not.toEqual(expect.stringContaining('Insufficient scope'))
    expect(result).not.toEqual(expect.stringContaining('403'))
  })

  test('offers no navigation to areas a refused user cannot open', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/refused'
    })

    expect(result).not.toEqual(expect.stringContaining('Operations Admin'))
    expect(result).not.toEqual(expect.stringContaining('Applications Admin'))
  })
})

describe('catchAll', () => {
  const mockErrorLogger = vi.fn()
  const mockWarnLogger = vi.fn()
  const mockStack = 'Mock error stack'
  const mockMessage = 'Insufficient scope'
  const mockPath = '/grant-ops'
  const errorPage = 'error'
  const mockRequest = (statusCode: number, message = mockMessage) =>
    ({
      path: mockPath,
      response: {
        isBoom: true,
        stack: mockStack,
        message,
        output: {
          statusCode
        }
      },
      logger: { error: mockErrorLogger, warn: mockWarnLogger }
    }) as unknown as Request
  const mockToolkitView = vi.fn()
  const mockToolkitCode = vi.fn()
  const mockToolkit = {
    view: mockToolkitView.mockReturnThis(),
    code: mockToolkitCode.mockReturnThis()
  } as unknown as ResponseToolkit

  test('renders the "Not Found" page', () => {
    catchAll(mockRequest(statusCodes.notFound), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Page not found',
      heading: statusCodes.notFound,
      message: 'Page not found'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.notFound)
  })

  test('renders the "Forbidden" page', () => {
    catchAll(mockRequest(statusCodes.forbidden), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith('forbidden', {
      pageTitle: 'You do not have access to this part of the service',
      heading: 'You do not have access to this part of the service'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.forbidden)
  })

  test('logs why a refused request was refused rather than showing it', () => {
    catchAll(mockRequest(statusCodes.forbidden), mockToolkit)

    expect(mockWarnLogger).toHaveBeenCalledWith(
      `Refused ${mockPath}: ${mockMessage}`
    )
  })

  test('renders the generic page for a forbidden request that is not about a role', () => {
    catchAll(
      mockRequest(
        statusCodes.forbidden,
        'You do not have access to administration for this grant'
      ),
      mockToolkit
    )

    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Forbidden',
      heading: statusCodes.forbidden,
      message: 'Forbidden'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.forbidden)
  })

  test('renders the "Unauthorized" page', () => {
    catchAll(mockRequest(statusCodes.unauthorized), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Unauthorized',
      heading: statusCodes.unauthorized,
      message: 'Unauthorized'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.unauthorized)
  })

  test('renders the "Bad Request" page', () => {
    catchAll(mockRequest(statusCodes.badRequest), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Bad Request',
      heading: statusCodes.badRequest,
      message: 'Bad Request'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.badRequest)
  })

  test('renders the default page for an unmapped status', () => {
    catchAll(mockRequest(statusCodes.imATeapot), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.imATeapot,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.imATeapot)
  })

  test('renders the "Something went wrong" page and logs the error for internalServerError', () => {
    catchAll(mockRequest(statusCodes.internalServerError), mockToolkit)

    expect(mockErrorLogger).toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.internalServerError,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(
      statusCodes.internalServerError
    )
  })
})
