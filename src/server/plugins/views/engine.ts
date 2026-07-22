import path from 'node:path'
import nunjucks from 'nunjucks'

import { config } from '../../../common/config.ts'
import * as filters from '../../../common/views/filters/index.ts'
import * as globals from '../../../common/views/globals.ts'

export const viewsRoot = path.resolve(
  import.meta.dirname,
  '../../../common/views'
)

/**
 * Resolves what a page pulls in — `extends`, `import`, `include` — which is why
 * the search path only needs govuk-frontend and the shared view kit.
 *
 * Entry pages are resolved separately, by the vision managers in ./index.ts.
 * Keeping the two apart is what lets a domain hold its pages next to the routes
 * that render them, without this search path having to know the domain exists.
 */
export const environment = nunjucks.configure(
  [
    'node_modules/govuk-frontend/dist/',
    viewsRoot,
    path.join(viewsRoot, 'components')
  ],
  {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
    watch: config.get('nunjucks.watch'),
    noCache: config.get('nunjucks.noCache')
  }
)

Object.entries(globals).forEach(([name, global]) => {
  environment.addGlobal(name, global)
})

Object.entries(filters).forEach(([name, filter]) => {
  environment.addFilter(name, filter)
})
