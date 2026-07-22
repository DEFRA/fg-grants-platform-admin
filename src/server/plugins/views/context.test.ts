import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'
import { context } from './context.ts'

vi.mock(import('../../../common/config.ts'))
vi.mock(import('../../../common/logger.ts'))

const manifest = {
  'application.js': { file: 'javascripts/application.js' },
  'stylesheets/application.scss': { file: 'stylesheets/application.css' }
}

let viteRoot: string

beforeAll(async () => {
  viteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-root-'))

  const manifestDir = path.join(viteRoot, '.public/.vite')
  await fs.mkdir(manifestDir, { recursive: true })
  await fs.writeFile(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify(manifest)
  )
})

afterAll(() => fs.rm(viteRoot, { recursive: true, force: true }))

describe('context', () => {
  beforeEach(() => {
    config.set('root', viteRoot)
  })

  test('marks only the navigation item matching the path as current', async () => {
    await expect(
      context({ path: '/non-existent-path' })
    ).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/operations', current: false },
        { text: 'Applications Admin', href: '/applications', current: false }
      ]
    })

    await expect(context({ path: '/operations' })).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/operations', current: true },
        { text: 'Applications Admin', href: '/applications', current: false }
      ]
    })

    await expect(context({ path: '/applications' })).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/operations', current: false },
        { text: 'Applications Admin', href: '/applications', current: true }
      ]
    })
  })

  test('provides the view context', async () => {
    await expect(context({ path: '/' })).resolves.toEqual({
      assetPath: '/public/assets',
      breadcrumbs: [],
      getAssetPath: expect.any(Function),
      navigation: [
        { current: false, text: 'Operations Admin', href: '/operations' },
        { current: false, text: 'Applications Admin', href: '/applications' }
      ],
      serviceName: 'fg-grants-platform-admin',
      serviceUrl: '/'
    })
  })
})

describe('getAssetPath', () => {
  beforeEach(() => {
    config.set('root', viteRoot)
  })

  test('serves the asset from source outside production, ignoring the manifest', async () => {
    const { getAssetPath } = await context()

    expect(getAssetPath('application.js')).toBe('/public/application.js')
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('serves the hashed file the manifest names in production', async () => {
    config.set('isProduction', true)

    const { getAssetPath } = await context()

    expect(getAssetPath('application.js')).toBe(
      '/public/javascripts/application.js'
    )
  })

  test('falls back to the asset name when it is absent from the manifest', async () => {
    config.set('isProduction', true)

    const { getAssetPath } = await context()

    expect(getAssetPath('an-image.png')).toBe('/public/an-image.png')
  })

  test('logs and falls back to the asset name when the manifest is missing', async () => {
    config.set('isProduction', true)
    config.set('root', path.join(viteRoot, 'absent'))

    const { getAssetPath } = await context()

    expect(logger.error).toHaveBeenCalledWith('Vite manifest.json not found')
    expect(getAssetPath('application.js')).toBe('/public/application.js')
  })
})
