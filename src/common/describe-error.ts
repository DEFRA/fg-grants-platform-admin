/**
 * One line describing a failure, safe to log.
 *
 * @hapi/wreck answers a non-2xx with a Boom carrying `data.payload` — the
 * backend's response body — and `data.res`. The logger nests error objects
 * (src/common/logger.ts) and redacts nothing outside production, so handing it
 * such an error would write a payload we promised never to write. Only the
 * name and message leave this function.
 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error'
