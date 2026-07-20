import path from 'path'
import nunjucks from 'nunjucks'
import hapiVision from '@hapi/vision'
import { fileURLToPath } from 'node:url'

import { config } from '../config.ts'
import { context } from './context/context.ts'
import * as filters from './filters/filters.ts'
import * as globals from './globals/globals.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const nunjucksEnvironment = nunjucks.configure(
  [
    'node_modules/govuk-frontend/dist/',
    path.resolve(dirname, '../../server/common/templates'),
    path.resolve(dirname, '../../server/common/components')
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

export const nunjucksConfig = {
  plugin: hapiVision,
  options: {
    engines: {
      njk: {
        compile(src: string, options: { environment: nunjucks.Environment }) {
          const template = nunjucks.compile(src, options.environment)
          return (ctx: object) => template.render(ctx)
        }
      }
    },
    compileOptions: {
      environment: nunjucksEnvironment
    },
    relativeTo: path.resolve(dirname, '../..'),
    path: 'server/routes',
    isCached: config.get('isProduction'),
    context
  }
}

Object.entries(globals).forEach(([name, global]) => {
  nunjucksEnvironment.addGlobal(name, global)
})

Object.entries(filters).forEach(([name, filter]) => {
  nunjucksEnvironment.addFilter(name, filter)
})
