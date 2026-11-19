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
