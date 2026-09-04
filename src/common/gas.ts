import { config } from './config.ts'
import { wreck } from './wreck.ts'

/**
 * Reads a json payload from fg-gas-backend.
 *
 * Every route there sits behind its `service` bearer strategy, so a request
 * without the token is answered with a 401 rather than the payload. Holding
 * that in one place keeps each repository to the path it asks for.
 *
 * @param path An absolute path, with its segments already escaped.
 */
export const getFromGas = async <T>(path: string): Promise<T> => {
  const { payload } = await wreck.get<T>(`${config.get('gas.apiUrl')}${path}`, {
    json: true,
    headers: {
      authorization: `Bearer ${config.get('gas.serviceToken')}`
    }
  })

  return payload
}

/**
 * What a write to fg-gas-backend may carry beyond its path.
 *
 * `payload` is the json body, on the one write that takes one — park, which
 * carries the reason an operator typed. `actor` is who asked: the signed in
 * user, as the routes read them off the session, forwarded on `x-actor` so the
 * backend's audit record names a person rather than this app's service token.
 * Both are absent by default, and an absent actor sends no header at all
 * rather than an empty one — a blank `x-actor` would be a claim that nobody
 * asked, which is a different thing from not saying.
 */
export interface GasWriteOptions {
  payload?: object
  actor?: string
}

/**
 * Posts to fg-gas-backend and reads its json answer.
 *
 * The writes this app makes: a redrive, a bulk redrive by query, a park and an
 * unpark. Most are identified entirely by their path and send no body at all;
 * the one that needs a reason sends it as json.
 *
 * A non-2xx arrives here as the Boom `@hapi/wreck` throws, carrying the
 * upstream status on `output.statusCode` and the response body on
 * `data.payload`. Both matter to the caller — a 409 names the status that
 * refused the write — so the error is left exactly as it is rather than
 * flattened into one of our own.
 *
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
      ...(payload === undefined ? {} : { payload }),
      headers: {
        authorization: `Bearer ${config.get('gas.serviceToken')}`,
        ...(actor ? { 'x-actor': actor } : {})
      }
    }
  )

  return body
}
