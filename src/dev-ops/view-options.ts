import path from 'node:path'
import nunjucks from 'nunjucks'

import { config } from '../common/config.ts'
import { assets } from '../server/plugins/views/assets.ts'
import {
  buildViewOptions,
  type ViewContextRequest
} from '../server/plugins/views/index.ts'

/**
 * The dev-ops app's own nunjucks environment. Its search path is this
 * domain's views directory alone — no govuk-frontend, no src/common/views —
 * because dev-ops is a separate app on daisyUI, not a GDS domain: the two
 * design systems meet only at the server and auth layer, never in a template.
 */
const viewsPath = path.resolve(import.meta.dirname, 'views')

export const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(
    [viewsPath, path.join(viewsPath, 'components')],
    {
      watch: config.get('nunjucks.watch'),
      noCache: config.get('nunjucks.noCache')
    }
  ),
  {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true
  }
)

/**
 * An operator with four tabs open needs the one they are about to redrive an
 * event in to look different from the other three, and only production is
 * worth a warning colour; everywhere else the badge simply says where it is.
 *
 * The classes themselves are in layouts/page.njk: Tailwind scans views/ for
 * candidates and a class name spelled only here is purged from the stylesheet
 * without a word of warning.
 */
const productionLabel = 'prod'
const themeCookieName = 'dev-ops-theme'
const themes = { dark: 'dark', light: 'light' } as const

const selectedTheme = (request?: ViewContextRequest) => {
  const theme = String(request?.state?.[themeCookieName])
  return themes[theme as keyof typeof themes] ?? null
}

const context = async (request?: ViewContextRequest) => {
  const environmentLabel = config.get('environmentLabel')

  return {
    serviceName: config.get('serviceName'),
    devOpsTheme: selectedTheme(request),
    environmentLabel,
    environmentIsProduction: environmentLabel === productionLabel,
    ...(await assets())
  }
}

export const devOpsViewOptions = buildViewOptions(environment, context)
