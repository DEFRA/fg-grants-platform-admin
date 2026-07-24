import vision from '@hapi/vision'
import nunjucks from 'nunjucks'

import { context } from './context.ts'
import { environment, viewsRoot } from './engine.ts'
import { config } from '../../../common/config.ts'

/**
 * Everything a views manager needs apart from where its pages live. A domain
 * spreads this into its own `server.views()` call, adding `relativeTo` and
 * `path`, so vision resolves `h.view('index')` against that domain's directory
 * — a handler never names a path through the source tree, and this file never
 * names a domain.
 */
export const viewOptions = {
  engines: {
    njk: {
      compile(src: string, options: { environment: nunjucks.Environment }) {
        const template = nunjucks.compile(src, options.environment)
        return (ctx: object) => template.render(ctx)
      }
    }
  },
  compileOptions: {
    environment
  },
  isCached: config.get('isProduction'),
  context
}

/**
 * The fallback views manager, holding the pages that belong to no domain.
 *
 * Registered directly on the root server in ../../index.ts rather than wrapped
 * in a plugin of its own, because vision assigns the manager it builds to the
 * realm of whoever registers it. Wrapping this would bury the manager in that
 * wrapper's realm, where a route on the root server could no longer see it, and
 * the only symptom would be error pages failing to render.
 */
export const views = {
  plugin: vision,
  options: {
    ...viewOptions,
    relativeTo: viewsRoot,
    path: 'pages'
  }
}
