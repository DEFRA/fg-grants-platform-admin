import path from 'node:path'
import { readFileSync } from 'node:fs'

import { config } from '#/config/config.ts'
import { buildNavigation } from './build-navigation.ts'
import { createLogger } from '#/server/common/helpers/logging/logger.ts'

const logger = createLogger()
const assetPath = config.get('assetPath')
const manifestPath = path.join(
  config.get('root'),
  '.public/.vite/manifest.json'
)

interface ViteManifestEntry {
  file: string
}

type ViteManifest = Record<string, ViteManifestEntry>

let viteManifest: ViteManifest | undefined

export function context(request?: { path?: string }) {
  if (config.get('isProduction') && !viteManifest) {
    try {
      viteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      logger.error(`Vite ${path.basename(manifestPath)} not found`)
    }
  }

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: '/',
    breadcrumbs: [] as { text: string; href?: string }[],
    navigation: buildNavigation(request),
    getAssetPath(asset: string) {
      if (!config.get('isProduction')) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = viteManifest?.[asset]?.file
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
