import { vi } from 'vitest'

const mockReadFileSync = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('node:fs', async () => {
  const nodeFs = await import('node:fs')

  return {
    ...nodeFs,
    readFileSync: () => mockReadFileSync()
  }
})
vi.mock('../../../server/common/helpers/logging/logger.ts', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockLoggerError(...args)
  })
}))
vi.mock(import('#/config/config.ts'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    config: {
      get(key: Parameters<typeof originalModule.config.get>[0]) {
        if (key === 'isProduction') return true
        return originalModule.config.get(key)
      }
    }
  } as unknown as typeof originalModule
})

describe('context and cache', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset()
    mockLoggerError.mockReset()
    vi.resetModules()
  })

  describe('#context', () => {
    const mockRequest = { path: '/' }

    describe('When Vite manifest file read succeeds', () => {
      let contextImport: typeof import('./context.ts')
      let contextResult: ReturnType<(typeof import('./context.ts'))['context']>

      beforeAll(async () => {
        contextImport = await import('./context.ts')
      })

      beforeEach(() => {
        // Return JSON string
        mockReadFileSync.mockReturnValue(`{
        "application.js": "javascripts/application.js",
        "stylesheets/application.scss": "stylesheets/application.css"
      }`)

        contextResult = contextImport.context(mockRequest)
      })

      test('Should provide expected context', () => {
        expect(contextResult).toEqual({
          assetPath: '/public/assets',
          breadcrumbs: [],
          getAssetPath: expect.any(Function),
          navigation: [
            {
              current: true,
              text: 'Home',
              href: '/'
            },
            {
              current: false,
              text: 'Operations Admin',
              href: '/operations-admin'
            },
            {
              current: false,
              text: 'Applications Admin',
              href: '/applications-admin'
            }
          ],
          serviceName: 'fg-grants-platform-admin',
          serviceUrl: '/'
        })
      })

      describe('With valid asset path', () => {
        test('Should provide expected asset path', () => {
          expect(contextResult.getAssetPath('application.js')).toBe(
            '/public/application.js'
          )
        })
      })

      describe('With invalid asset path', () => {
        test('Should provide expected asset', () => {
          expect(contextResult.getAssetPath('an-image.png')).toBe(
            '/public/an-image.png'
          )
        })
      })
    })

    describe('When Vite manifest file read fails', () => {
      let contextImport: typeof import('./context.ts')

      beforeAll(async () => {
        contextImport = await import('./context.ts')
      })

      beforeEach(() => {
        mockReadFileSync.mockReturnValue(new Error('File not found'))

        contextImport.context(mockRequest)
      })

      test('Should log that the Vite Manifest file is not available', () => {
        expect(mockLoggerError).toHaveBeenCalledWith(
          'Vite manifest.json not found'
        )
      })
    })
  })

  describe('#context cache', () => {
    const mockRequest = { path: '/' }
    let contextResult: ReturnType<(typeof import('./context.ts'))['context']>

    describe('Vite manifest file cache', () => {
      let contextImport: typeof import('./context.ts')

      beforeAll(async () => {
        contextImport = await import('./context.ts')
      })

      beforeEach(() => {
        // Return JSON string
        mockReadFileSync.mockReturnValue(`{
        "application.js": "javascripts/application.js",
        "stylesheets/application.scss": "stylesheets/application.css"
      }`)

        contextResult = contextImport.context(mockRequest)
      })

      test('Should read file', () => {
        expect(mockReadFileSync).toHaveBeenCalled()
      })

      test('Should use cache', () => {
        expect(mockReadFileSync).not.toHaveBeenCalled()
      })

      test('Should provide expected context', () => {
        expect(contextResult).toEqual({
          assetPath: '/public/assets',
          breadcrumbs: [],
          getAssetPath: expect.any(Function),
          navigation: [
            {
              current: true,
              text: 'Home',
              href: '/'
            },
            {
              current: false,
              text: 'Operations Admin',
              href: '/operations-admin'
            },
            {
              current: false,
              text: 'Applications Admin',
              href: '/applications-admin'
            }
          ],
          serviceName: 'fg-grants-platform-admin',
          serviceUrl: '/'
        })
      })
    })
  })
})
