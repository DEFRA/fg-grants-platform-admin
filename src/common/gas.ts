import Boom from '@hapi/boom'
import Wreck from '@hapi/wreck'
import type { IncomingMessage } from 'node:http'

import { currentUpstream, type Upstream } from '../dev-ops/upstream.ts'
import type { Shell } from '../dev-ops/repositories/shell.repository.ts'
import { config } from './config.ts'
import { currentGasActor, toHeaderActor } from './gas-actor.ts'
import { wreck } from './wreck.ts'

/** No actor sends no `x-actor`: a blank one would claim nobody asked. */
export interface GasWriteOptions {
  payload?: object
  actor?: string
  headers?: Record<string, string>
  /** For a call GAS gives longer than the usual timeout to answer. */
  timeoutMs?: number
}

export { toHeaderActor }

/**
 * The service token, and the operator the call is made for: GAS audits every
 * read and write under their Entra object id. A name passed in wins over the
 * request's, as a write names the person it was made by.
 */
const toHeaders = (actor?: string): Record<string, string> => {
  const { name, id } = currentGasActor()
  const shown = actor ?? name

  return {
    authorization: `Bearer ${config.get('gas.serviceToken')}`,
    ...(shown ? { 'x-actor': toHeaderActor(shown) } : {}),
    ...(id ? { 'x-actor-id': id } : {})
  }
}

const shellOf = (body: unknown): Shell | null => {
  const shell = (body as { shell?: unknown } | null)?.shell

  return typeof shell === 'object' && shell !== null ? (shell as Shell) : null
}

const keepShell = (upstream: Upstream, body: unknown): void => {
  upstream.shell = shellOf(body) ?? upstream.shell
}

/** The body GAS answered a failed call with, as @hapi/wreck carries it. */
export const errorBodyOf = (error: unknown): unknown =>
  (error as { data?: { payload?: unknown } } | null)?.data?.payload

/**
 * Inside a Dev Ops request each call is counted, and the shell an answer
 * carries, refusals included, is kept for the page drawn from it.
 */
const counted = async <T>(call: () => Promise<{ payload: T }>): Promise<T> => {
  const upstream = currentUpstream()

  if (upstream === null) {
    return (await call()).payload
  }

  upstream.calls += 1

  try {
    const { payload } = await call()
    keepShell(upstream, payload)

    return payload
  } catch (error) {
    keepShell(upstream, errorBodyOf(error))
    throw error
  }
}

/** @param path An absolute path, with its segments already escaped. */
export const getFromGas = async <T>(path: string): Promise<T> =>
  counted(() =>
    wreck.get<T>(`${config.get('gas.apiUrl')}${path}`, {
      json: true,
      timeout: config.get('gas.timeoutMs'),
      headers: toHeaders()
    })
  )

const toTimeout = (timeoutMs: number | undefined): number =>
  timeoutMs ?? config.get('gas.timeoutMs')

const writeToGas = async <T>(
  method: 'post' | 'put' | 'delete',
  path: string,
  { payload, actor, headers = {}, timeoutMs }: GasWriteOptions = {}
): Promise<T> =>
  counted(() =>
    wreck[method]<T>(`${config.get('gas.apiUrl')}${path}`, {
      json: true,
      timeout: toTimeout(timeoutMs),
      ...(payload === undefined ? {} : { payload }),
      headers: { ...toHeaders(actor), ...headers }
    })
  )

/**
 * A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it.
 * @param path An absolute path, with its segments already escaped.
 */
export const postToGas = async <T>(
  path: string,
  options?: GasWriteOptions
): Promise<T> => writeToGas<T>('post', path, options)

/**
 * A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it.
 * @param path An absolute path, with its segments already escaped.
 */
export const putToGas = async <T>(
  path: string,
  options?: GasWriteOptions
): Promise<T> => writeToGas<T>('put', path, options)

/**
 * A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it.
 * @param path An absolute path, with its segments already escaped.
 */
export const deleteFromGas = async <T>(
  path: string,
  options?: GasWriteOptions
): Promise<T> => writeToGas<T>('delete', path, options)

/** GAS's refusals are short; one past this isn't read further. */
const errorBodyMax = 1024 * 1024

/** As @hapi/wreck rejects a 4xx or 5xx: the status, and the body GAS answered with, read for no longer than the body's idle time. */
const toResponseError = async (
  response: IncomingMessage,
  idleMs: number
): Promise<Error> => {
  const payload = await Wreck.read(response, {
    json: 'force',
    maxBytes: errorBodyMax,
    timeout: idleMs
  }).catch(() => null)

  return Boom.boomify(new Error(`Response Error: ${response.statusCode}`), {
    statusCode: response.statusCode,
    data: { isResponseError: true, headers: response.headers, payload }
  })
}

const isAnswered = (response: IncomingMessage): boolean =>
  (response.statusCode ?? 0) < 400

/** A body that moved no bytes for its idle time: GAS stopped sending, or its reader stopped reading. */
class GasStreamIdleError extends Error {
  constructor() {
    super('fg-gas-backend’s answer moved no bytes for its idle time')
    this.name = 'GasStreamIdleError'
  }
}

/** A body that moves no bytes for `idleMs` is let go, so whoever reads it sees it break rather than wait for ever: whether GAS stopped sending or the reader stopped reading (a stalled download), the socket is idle either way. */
const stopWhenIdle = (response: IncomingMessage, idleMs: number): void => {
  response.setTimeout(idleMs, () => {
    response.destroy(new GasStreamIdleError())
  })
}

/**
 * A POST whose answer is read as it comes: a 4xx or 5xx rejects as
 * {@link postToGas} does, before any of it is read; a body that sends
 * nothing for `idleMs` breaks. Counted as one call; the caller reads the
 * stream to its end, or destroys it.
 * @param path An absolute path, with its segments already escaped.
 */
export const streamFromGas = async (
  path: string,
  {
    payload,
    timeoutMs,
    idleMs
  }: Pick<GasWriteOptions, 'payload' | 'timeoutMs'> & { idleMs: number }
): Promise<IncomingMessage> =>
  counted(async () => {
    const response = await wreck.request(
      'POST',
      `${config.get('gas.apiUrl')}${path}`,
      {
        payload: JSON.stringify(payload ?? {}),
        timeout: toTimeout(timeoutMs),
        headers: { ...toHeaders(), 'content-type': 'application/json' }
      }
    )

    if (!isAnswered(response)) {
      throw await toResponseError(response, idleMs)
    }

    stopWhenIdle(response, idleMs)

    return { payload: response }
  })
