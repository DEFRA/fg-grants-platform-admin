import { getTraceId } from '@defra/hapi-tracing'
import Wreck from '@hapi/wreck'

import { config } from './config.ts'

const tracingHeader = config.get('tracing.header')

const defaultTimeoutMs = 3000

/**
 * Shared http client. Every request carries the inbound CDP request id onwards,
 * so a trace spans this app and whatever it calls. `@defra/hapi-tracing` keeps
 * that id in async local storage, which is why it can be read below without
 * threading the hapi request through.
 */
export const wreck = Wreck.defaults({
  events: true,
  timeout: defaultTimeoutMs,
  json: true
})

wreck.events!.on('preRequest', (uri) => {
  const traceId = getTraceId()

  if (traceId) {
    // Wreck hands the listener the mutable request options, not the `string`
    // its bundled types claim, and mutating `headers` here is how the header
    // reaches the outgoing request.
    const { headers } = uri as unknown as { headers: Record<string, string> }

    headers[tracingHeader] = traceId
  }
})
