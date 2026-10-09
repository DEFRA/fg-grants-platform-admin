import { config } from './config.ts'
import { currentGasActor, toHeaderActor } from './gas-actor.ts'
import { wreck } from './wreck.ts'

/** No actor sends no `x-actor`: a blank one would claim nobody asked. */
export interface GasWriteOptions {
  payload?: object
  actor?: string
  headers?: Record<string, string>
}

export { toHeaderActor }

/**
 * The service token, and the operator the call is made for: GAS audits every
 * read and write under their Entra object id. A name passed in wins over the
 * request's, as a write names the person it was made by.
 */
const rolesHeader = (cwRoles?: string[] | null): Record<string, string> =>
  Array.isArray(cwRoles) && cwRoles.length > 0
    ? { 'x-user-roles': cwRoles.join(',') }
    : {}

const toHeaders = (actor?: string): Record<string, string> => {
  const { name, id, cwRoles } = currentGasActor()
  const shown = actor ?? name

  return {
    authorization: `Bearer ${config.get('gas.serviceToken')}`,
    ...(shown ? { 'x-actor': toHeaderActor(shown) } : {}),
    ...(id ? { 'x-actor-id': id } : {}),
    ...rolesHeader(cwRoles)
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

const writeToGas = async <T>(
  method: 'post' | 'put',
  path: string,
  { payload, actor, headers = {} }: GasWriteOptions = {}
): Promise<T> => {
  const { payload: body } = await wreck[method]<T>(
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
