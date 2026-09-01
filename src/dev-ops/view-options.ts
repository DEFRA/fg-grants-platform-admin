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

const context = async () => ({
  serviceName: config.get('serviceName'),
  ...(await assets())
})

export const devOpsViewOptions = buildViewOptions(environment, context)
