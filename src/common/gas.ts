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
