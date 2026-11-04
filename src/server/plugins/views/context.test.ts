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
  const sessionFor = (roles: string[]) => ({
    yar: { id: 'a-session', get: () => ({ claims: { roles } }) }
  })

  const bothRoles = sessionFor([
    'FCP.GrantOperationsAdmin',
    'FCP.GrantApplicationsAdmin'
  ])

  beforeEach(() => {
    config.set('root', viteRoot)
  })

  test('marks only the navigation item matching the path as current', async () => {
    await expect(
      context({ ...bothRoles, path: '/non-existent-path' })
    ).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/dev-ops', current: false },
        { text: 'Applications Admin', href: '/grant-ops', current: false }
      ]
    })

    await expect(
      context({ ...bothRoles, path: '/dev-ops' })
    ).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/dev-ops', current: true },
        { text: 'Applications Admin', href: '/grant-ops', current: false }
      ]
    })

    await expect(
      context({ ...bothRoles, path: '/grant-ops' })
    ).resolves.toMatchObject({
      navigation: [
        { text: 'Operations Admin', href: '/dev-ops', current: false },
        { text: 'Applications Admin', href: '/grant-ops', current: true }
      ]
    })
  })

  test('offers only the areas the user holds a role for', async () => {
    await expect(
      context({ ...sessionFor(['FCP.GrantApplicationsAdmin']), path: '/' })
    ).resolves.toMatchObject({
      navigation: [
        { text: 'Applications Admin', href: '/grant-ops', current: false }
      ]
    })
  })

  test('offers nothing to a user with no roles', async () => {
    await expect(
      context({ ...sessionFor([]), path: '/' })
    ).resolves.toMatchObject({ navigation: [] })
  })

  test('offers nothing when there is no session to read roles from', async () => {
    await expect(context({ path: '/' })).resolves.toMatchObject({
      navigation: []
    })
  })

  test('offers nothing when the session was never loaded, as on an unmatched route', async () => {
    const unloaded = {
      yar: {
        id: null,
        get: () => {
          throw new Error('The store is not loaded')
        }
      }
    }

    await expect(context({ ...unloaded, path: '/' })).resolves.toMatchObject({
      navigation: []
    })
  })

  test('provides the view context', async () => {
    await expect(context({ ...bothRoles, path: '/' })).resolves.toEqual({
      assetPath: '/public/assets',
      breadcrumbs: [],
      getAssetPath: expect.any(Function),
      navigation: [
        { current: false, text: 'Operations Admin', href: '/dev-ops' },
        { current: false, text: 'Applications Admin', href: '/grant-ops' }
      ],
      serviceName: 'Grants Platform Administration'
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
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('logs and falls back to the asset name when it is absent from the manifest', async () => {
    config.set('isProduction', true)

    const { getAssetPath } = await context()

    expect(getAssetPath('an-image.png')).toBe('/public/an-image.png')
    expect(logger.error).toHaveBeenCalledWith(
      'Vite manifest has no entry for an-image.png, so the page references /public/an-image.png, which will 404'
    )
  })

  test('logs and falls back to the asset name when the manifest is missing', async () => {
    config.set('isProduction', true)
    config.set('root', path.join(viteRoot, 'absent'))

    const { getAssetPath } = await context()

    expect(logger.error).toHaveBeenCalledWith('Vite manifest.json not found')
    expect(getAssetPath('application.js')).toBe('/public/application.js')
  })
})
