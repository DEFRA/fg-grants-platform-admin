import camelCase from 'lodash/camelCase.js'
import { load, type CheerioAPI, type CheerioOptions } from 'cheerio'

import { environment } from '../src/server/plugins/views/engine.ts'

export type RenderedComponent = CheerioAPI

/**
 * Renders a single component macro and hands back a cheerio document ready to
 * query. The rendered html is still reachable through `$.html()`.
 *
 * @param name The component directory, which is also the macro name once
 *   camel cased and prefixed, e.g. `heading` renders `appHeading`.
 * @param params The macro's params object.
 * @param block Markup for a component that is called with a body.
 * @param options Passed to cheerio, e.g. `{ xml: true }`.
 */
export const render = (
  name: string,
  params: object,
  block?: string,
  options?: CheerioOptions
): RenderedComponent => {
  const macro = {
    path: `${name}/macro.njk`,
    name: `app${name.charAt(0).toUpperCase()}${camelCase(name.slice(1))}`,
    params: JSON.stringify(params, null, 2)
  }

  const callComponent = block
    ? `{%- call ${macro.name}(${macro.params}) -%}${block}{%- endcall -%}`
    : `{{- ${macro.name}(${macro.params}) -}}`

  const html = environment.renderString(
    `{%- from "${macro.path}" import ${macro.name} -%}
    ${callComponent}
    `,
    {}
  )

  return load(html, options)
}
