import Boom from '@hapi/boom'
import type { Server, ServerInjectOptions } from '@hapi/hapi'
import type { CheerioAPI } from 'cheerio'

import { config } from '../common/config.ts'
import { wreck } from '../common/wreck.ts'
import type { Shell } from './repositories/shell.repository.ts'
import { currentUpstream, type Upstream } from './upstream.ts'
import { catalogue, outboxBucket } from './use-cases/test-fixtures.ts'

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
        path: `marked/${marker}`,
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
/** The style nonce a response's content security policy allows. */
export const styleNonceOf = (csp: unknown): string | undefined =>
  /style-src [^;]*'nonce-([^']+)'/.exec(String(csp))?.[1]

/**
 * Each table a DataTable drew, and whether its column widths are in a
 * <style> the response's policy allows, so every browser draws them on load.
 */
export const tableStyles = ($: CheerioAPI, csp: unknown) => {
  const nonce = styleNonceOf(csp)
  const styles = $('style')
    .toArray()
    .map((element) => ({
      nonce: $(element).attr('nonce'),
      text: $(element).text()
    }))

  return $('table[data-gpa-table]')
    .toArray()
    .map((table) => {
      const selector = `[data-gpa-table="${$(table).attr('data-gpa-table')}"]`
      const widths = `--gpa-cols:${$(table).attr('data-gpa-cols')};`
      const style = styles.find(({ text }) => text.startsWith(selector)) ?? {
        nonce: undefined,
        text: ''
      }

      return {
        label: $(table).attr('aria-label'),
        nonced: Boolean(nonce) && style.nonce === nonce,
        widths: style.text.includes(widths)
      }
    })
}

/** Every table on the page has its widths in a nonce'd <style>. */
export const expectTablesStyled = ($: CheerioAPI, csp: unknown) => {
  tableStyles($, csp).forEach((style) => {
    expect(style).toEqual({ label: style.label, nonced: true, widths: true })
  })
}
