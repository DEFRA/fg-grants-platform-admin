import path from 'node:path'
import nunjucks from 'nunjucks'

import { config } from '../common/config.ts'
import { assets } from '../server/plugins/views/assets.ts'
import { buildViewOptions } from '../server/plugins/views/index.ts'

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
 * The environments whose badge is amber. An operator with four tabs open needs
 * the one they are about to redrive an event in to look different from the
 * other three, and only one of them is worth a warning colour; everywhere else
 * the badge is a neutral label that simply says where it is. Both spellings
 * are accepted because the value is set by a deployment, not by this app, and
 * matched case-insensitively for the same reason.
 *
 * The classes themselves are in layouts/page.njk: Tailwind scans views/ for
 * candidates and a class name spelled only here is purged from the stylesheet
 * without a word of warning.
 */
const productionLabels = ['prod', 'production']

const context = async () => {
  const environmentLabel = config.get('environmentLabel') as string

  return {
    serviceName: config.get('serviceName'),
    environmentLabel,
    environmentIsProduction: productionLabels.includes(
      environmentLabel.trim().toLowerCase()
    ),
    ...(await assets())
  }
}

export const devOpsViewOptions = buildViewOptions(environment, context)
