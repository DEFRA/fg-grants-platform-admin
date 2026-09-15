import { config } from './config.ts'
import { wreck } from './wreck.ts'

/** @param path An absolute path, with its segments already escaped. */
export const getFromGas = async <T>(path: string): Promise<T> => {
  const { payload } = await wreck.get<T>(`${config.get('gas.apiUrl')}${path}`, {
    json: true,
    timeout: config.get('gas.timeoutMs'),
    headers: {
      authorization: `Bearer ${config.get('gas.serviceToken')}`
    }
  })

  return payload
}

/** No actor sends no `x-actor`: a blank one would claim nobody asked. */
export interface GasWriteOptions {
  payload?: object
  actor?: string
}

/** Node refuses header values outside U+0020–U+00FF. */
const HEADER_SAFE = /^[\u0020-\u00ff]*$/

/** RFC 8187-encoded only when a name like `Łukasz` would not fit a header; GAS decodes the prefix. */
export const toHeaderActor = (actor: string): string =>
  HEADER_SAFE.test(actor) ? actor : `UTF-8''${encodeURIComponent(actor)}`

/**
 * A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it.
 * @param path An absolute path, with its segments already escaped.
 */
export const postToGas = async <T>(
  path: string,
  { payload, actor }: GasWriteOptions = {}
): Promise<T> => {
  const { payload: body } = await wreck.post<T>(
    `${config.get('gas.apiUrl')}${path}`,
    {
      json: true,
      timeout: config.get('gas.timeoutMs'),
      ...(payload === undefined ? {} : { payload }),
      headers: {
        authorization: `Bearer ${config.get('gas.serviceToken')}`,
        ...(actor ? { 'x-actor': toHeaderActor(actor) } : {})
      }
    }
  )

  return body
}
