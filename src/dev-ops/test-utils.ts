import camelCase from 'lodash/camelCase.js'
import { load, type CheerioAPI, type CheerioOptions } from 'cheerio'

import { environment } from './view-options.ts'

export type RenderedComponent = CheerioAPI

/**
 * Renders a dev-ops component macro and hands back a cheerio document
 * ready to query. The sharper tool when only the markup contract is under
 * test — no DOM environment needed.
 *
 * Deliberately parallel to, not shared with, test/utils.ts: the two apps'
 * test kits evolve with their own design systems, exactly as their view
 * stacks do.
 *
 * @param name The component directory, which is also the macro name once
 *   camel cased, e.g. `theme-toggle` renders `themeToggle`. No prefix: the
 *   dev-ops environment resolves no foreign components, so macro names
 *   have nothing to collide with.
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
    name: camelCase(name),
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

/**
 * Renders a dev-ops component macro into the live document, registering
 * the app's custom elements first so an enhanced component upgrades and
 * enhances exactly as it would on a page. A vanilla component mounts the same
 * way — it simply has no element waiting for it.
 *
 * Needs a DOM test environment: put `// @vitest-environment happy-dom` at the
 * top of the test file.
 *
 * @returns `document.body`, ready to query.
 */
export const mount = async (
  name: string,
  params: object,
  block?: string
): Promise<HTMLElement> => {
  if (typeof document === 'undefined') {
    throw new Error(
      'mount needs a DOM: add `// @vitest-environment happy-dom` to the test file'
    )
  }

  // Imported lazily because the element classes extend HTMLElement, which
  // only exists once a DOM environment is up — a top-level import would
  // crash every node-environment test that touches this module.
  await import('./views/components/index.ts')

  document.body.innerHTML = render(name, params, block)('body').html() ?? ''

  // Element enhancement is deferred a microtask past connection.
  await Promise.resolve()

  return document.body
}
