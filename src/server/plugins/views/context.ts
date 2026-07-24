import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'

type ViteManifestEntry = {
  file: string
}

type ViteManifest = Record<string, ViteManifestEntry>

const lookupViteAsset = (manifest: ViteManifest | undefined, asset: string) =>
  manifest?.[asset]?.file

const loadViteManifest = async (): Promise<ViteManifest | undefined> => {
  const manifestPath = path.join(
    config.get('root'),
    '.public/.vite/manifest.json'
  )

  try {
    const { default: manifest } = await import(
      pathToFileURL(manifestPath).href,
      { with: { type: 'json' } }
    )

    return manifest
  } catch {
    logger.error(`Vite ${path.basename(manifestPath)} not found`)

    return undefined
  }
}

const buildNavigation = (request?: { path?: string }) => [
  {
    text: 'Operations Admin',
    href: '/operations',
    current: request?.path === '/operations'
  },
  {
    text: 'Applications Admin',
    href: '/applications',
    current: request?.path === '/applications'
  }
]

export const context = async (request?: { path?: string }) => {
  const assetPath = config.get('assetPath')
  const isProduction = config.get('isProduction')
  const viteManifest = isProduction ? await loadViteManifest() : undefined

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: '/',
    breadcrumbs: [] as { text: string; href?: string }[],
    navigation: buildNavigation(request),
    getAssetPath(asset: string) {
      if (!isProduction) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = lookupViteAsset(viteManifest, asset)
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
