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

/**
 * The asset-resolution half of a view context: build plumbing rather than
 * design system, so it is shared by every domain's context however different
 * their pages look. In production, resolves through the Vite manifest to the
 * hashed file; otherwise straight to source, where the Vite middleware serves
 * it.
 */
export const assets = async () => {
  const assetPath = config.get('assetPath')
  const isProduction = config.get('isProduction')
  const viteManifest = isProduction ? await loadViteManifest() : undefined

  return {
    assetPath: `${assetPath}/assets`,
    getAssetPath(asset: string) {
      if (!isProduction) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = lookupViteAsset(viteManifest, asset)
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
