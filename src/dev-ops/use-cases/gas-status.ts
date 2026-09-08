/**
 * The status fg-gas-backend answered with, dug out of the error `@hapi/wreck`
 * throws for it.
 *
 * Every failure the list page can meet is the same fact — it could not be read
 * — so that page never had to ask. A single event is different: a 404 is a
 * page of its own, a 409 is a sentence naming the status that refused a
 * redrive, and only the rest are "something is down". Boom carries the
 * upstream status on `output.statusCode`, and nothing else about the error is
 * safe to look at.
 */
export const toGasStatusCode = (error: unknown): number | null => {
  const output = (error as { output?: { statusCode?: unknown } })?.output

  return typeof output?.statusCode === 'number' ? output.statusCode : null
}

/**
 * A field of the backend's own response body.
 *
 * Read for exactly one thing: the status a 409 names. The body is never
 * logged and never rendered as markup — nunjucks escapes it like any other
 * string the endpoint passed through — and anything that is not a string is
 * treated as absent rather than coerced into one.
 */
const toGasErrorPayload = (error: unknown): unknown =>
  (error as { data?: { payload?: unknown } })?.data?.payload

const toGasErrorBody = (error: unknown): Record<string, unknown> => {
  const payload = toGasErrorPayload(error)

  return payload === null || typeof payload !== 'object'
    ? {}
    : (payload as Record<string, unknown>)
}

export const toGasErrorField = (
  error: unknown,
  field: string
): string | null => {
  const value = toGasErrorBody(error)[field]

  return typeof value === 'string' ? value : null
}
