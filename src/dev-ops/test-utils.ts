import Boom from '@hapi/boom'
import type { Server, ServerInjectOptions } from '@hapi/hapi'
import camelCase from 'lodash/camelCase.js'
import { load, type CheerioAPI, type CheerioOptions } from 'cheerio'

import { config } from '../common/config.ts'
import { wreck } from '../common/wreck.ts'
import type { Shell } from './repositories/shell.repository.ts'
import { currentUpstream, type Upstream } from './upstream.ts'
import { catalogue, outboxBucket } from './use-cases/test-fixtures.ts'
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
 *   camel cased, e.g. `json-viewer` renders `jsonViewer`. No prefix: the
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
  await import('./views/legacy/index.ts')

  document.body.innerHTML = render(name, params, block)('body').html() ?? ''

  // Element enhancement is deferred a microtask past connection.
  await Promise.resolve()

  return document.body
}

/**
 * Whether a dialog is drawn open for a browser that runs no script: the
 * native `open` attribute shows it, and `data-open` tells the dialog element
 * to open it as a modal once the script does run. The convention for every
 * dialog a URL can ask for.
 */
export const isOpenWithoutScript = ($: CheerioAPI, id: string): boolean => {
  const dialog = $(`dialog#${id}`)

  return dialog.is('[open]') && dialog.parent('gpa-dialog').is('[data-open]')
}

/**
 * Where a dialog's × goes: the page without a script, and, with one, the
 * address the dialog puts back when it closes after the address opened it.
 */
export const closeHrefOf = ($: CheerioAPI, id: string): string | undefined =>
  $(`dialog#${id} a.gpa-dialog-close`).attr('href')

/** Whether a dialog's fields go back to what the server drew each time it's opened from the page. */
export const resetsOnOpen = ($: CheerioAPI, id: string): boolean =>
  $(`dialog#${id}`).parent('gpa-dialog').is('[data-reset-on-open]')

/** What the fake GAS answers a call with: a body, a refusal with or without one, or no answer at all. */
export type GasAnswer =
  | { status?: number; body?: unknown }
  | { fail: 'timeout' | 'refused' }

/** Keyed `METHOD /grant-admin/path/{param}`, as the calls are listed. */
export type FakeGas = Record<string, GasAnswer>

export interface CountedCall {
  method: string
  path: string
}

interface Fake {
  gas: FakeGas
  calls: CountedCall[]
}

const fakes = new WeakMap<Upstream, Fake>()

const methods = ['get', 'post', 'put', 'delete'] as const

const toPattern = (key: string) => {
  const [method, path] = key.split(' ')
  const source = path.replaceAll(/\{\w+\}/g, '[^/]+')

  return { method, path, matches: new RegExp(`^${source}$`) }
}

const toCall = (gas: FakeGas, method: string, path: string): CountedCall => {
  const found = Object.keys(gas)
    .map(toPattern)
    .find((pattern) => pattern.method === method && pattern.matches.test(path))

  return { method, path: found?.path ?? path }
}

const firstRefusal = 300

const failures = {
  timeout: () => Boom.gatewayTimeout('Client request timeout'),
  refused: () => Boom.badGateway('Client request error')
}

/** As wreck answers: a 2xx resolves its body, anything else rejects with a Boom carrying it, and a failure carries none. */
const toReply = ({
  status = 200,
  body
}: {
  status?: number
  body?: unknown
}) =>
  status < firstRefusal
    ? Promise.resolve({ res: { statusCode: status }, payload: body })
    : Promise.reject(
        new Boom.Boom(`Response Error: ${status}`, {
          statusCode: status,
          data: { isResponseError: true, payload: body ?? Buffer.alloc(0) }
        })
      )

const toAnswer = (answer: GasAnswer | undefined) => {
  if (answer === undefined) {
    return Promise.reject(Boom.notImplemented('No fake answer'))
  }

  return 'fail' in answer
    ? Promise.reject(failures[answer.fail]())
    : toReply(answer)
}

const answerFor = (verb: string) => (url: string) => {
  const upstream = currentUpstream()
  const fake = upstream && fakes.get(upstream)

  if (!fake) {
    return Promise.reject(new Error('GAS was called outside a counted request'))
  }

  const path = new URL(url).pathname.replace(
    new URL(config.get('gas.apiUrl')).pathname.replace(/\/$/, ''),
    ''
  )
  const call = toCall(fake.gas, verb.toUpperCase(), path)
  fake.calls.push(call)

  return toAnswer(fake.gas[`${call.method} ${call.path}`])
}

/**
 * Injects a request with GAS faked at the wreck level, so gas.ts counts the
 * calls and keeps the shell as it does for real. Returns the calls the request
 * made, each as its method and the fake's path pattern.
 */
export const injectCounted = async (
  server: Server,
  options: ServerInjectOptions,
  gas: FakeGas
) => {
  const upstream: Upstream = { calls: 0, shell: null }
  const fake: Fake = { gas, calls: [] }
  fakes.set(upstream, fake)

  for (const verb of methods) {
    vi.spyOn(wreck, verb).mockImplementation(answerFor(verb) as never)
  }

  const response = await server.inject({
    ...options,
    app: { ...(options.app as object), upstream }
  })

  return { response, calls: fake.calls, upstream }
}

/** The fixture catalogue, with one more list whose path names this shell, so a sidebar shows which answer drew it. */
export const toShell = (marker: string): Shell => ({
  catalogue: {
    buckets: [
      ...catalogue.buckets,
      {
        ...outboxBucket,
        id: `gas.${marker}`,
        path: `events/gas/${marker}`,
        label: marker,
        shortLabel: marker,
        order: 99
      }
    ],
    sourceErrors: []
  }
})

/** Every link in a page's sidebar navigation. */
export const sidebarHrefs = ($: CheerioAPI): string[] =>
  $('[data-testid="shell-nav"] a')
    .toArray()
    .map((link) => $(link).attr('href') ?? '')
