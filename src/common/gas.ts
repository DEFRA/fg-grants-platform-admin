import { config } from './config.ts'
import { currentGasActor } from './gas-actor.ts'
import { wreck } from './wreck.ts'

/** No actor sends no `x-actor`: a blank one would claim nobody asked. */
export interface GasWriteOptions {
  payload?: object
  actor?: string
  headers?: Record<string, string>
}

/** Node refuses header values outside U+0020–U+00FF. */
const HEADER_SAFE = /^[\u0020-\u00ff]*$/

/** RFC 8187-encoded only when a name like `Łukasz` would not fit a header; GAS decodes the prefix. */
export const toHeaderActor = (actor: string): string =>
  HEADER_SAFE.test(actor) ? actor : `UTF-8''${encodeURIComponent(actor)}`

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

/** @param path An absolute path, with its segments already escaped. */
export const getFromGas = async <T>(path: string): Promise<T> => {
  const { payload } = await wreck.get<T>(`${config.get('gas.apiUrl')}${path}`, {
    json: true,
    timeout: config.get('gas.timeoutMs'),
    headers: toHeaders()
  })

  return payload
}

/**
 * A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it.
 * @param path An absolute path, with its segments already escaped.
 */
export const postToGas = async <T>(
  path: string,
  { payload, actor, headers = {} }: GasWriteOptions = {}
): Promise<T> => {
  const { payload: body } = await wreck.post<T>(
    `${config.get('gas.apiUrl')}${path}`,
    {
      json: true,
      timeout: config.get('gas.timeoutMs'),
      ...(payload === undefined ? {} : { payload }),
      headers: { ...toHeaders(actor), ...headers }
    }
  )

  return body
}
