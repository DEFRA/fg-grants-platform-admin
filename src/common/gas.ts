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
 * What a write to fg-gas-backend may carry beyond its path. `actor` is who
 * asked, forwarded on `x-actor` so the backend's audit record names a person
 * rather than this app's service token; an absent actor sends no header at
 * all — a blank `x-actor` would be a claim that nobody asked.
 */
export interface GasWriteOptions {
  payload?: object
  actor?: string
}

/**
 * Every code point an HTTP header can carry as itself: Node refuses a header
 * value containing anything above U+00FF with `ERR_INVALID_CHAR`, and refuses
 * the control characters below U+0020 too.
 */
const HEADER_SAFE = /^[\u0020-\u00ff]*$/

/**
 * The operator's name, in a form a header can hold.
 *
 * An Entra name is whatever the directory holds — `Ŵyn`, `Łukasz`, a name with
 * combining marks — and Node throws on any of them, which arrived on the page
 * as "fg-gas-backend could not be reached": a redrive that never left this
 * process, reported as somebody else's outage.
 *
 * Encoded the way RFC 8187 encodes a header parameter, and only when it has to
 * be: an ASCII name travels exactly as it did, so the two services can be
 * deployed in either order. fg-gas-backend recognises the `UTF-8''` prefix and
 * decodes it; a name without one is taken verbatim, which is what every name
 * looked like before this existed.
 */
export const toHeaderActor = (actor: string): string =>
  HEADER_SAFE.test(actor) ? actor : `UTF-8''${encodeURIComponent(actor)}`

/**
 * Posts to fg-gas-backend and reads its json answer.
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
        ...(actor ? { 'x-actor': toHeaderActor(actor) } : {})
      }
    }
  )

  return body
}
