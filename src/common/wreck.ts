import { getTraceId } from '@defra/hapi-tracing'
import Wreck from '@hapi/wreck'

import { config } from './config.ts'

const tracingHeader = config.get('tracing.header')

/** Carries the inbound CDP request id onwards, read from hapi-tracing's async local storage. */
export const wreck = Wreck.defaults({
  events: true,
  json: true
})

wreck.events!.on('preRequest', (uri) => {
  const traceId = getTraceId()

  if (traceId) {
    // Wreck passes the mutable request options here, not the `string` its types claim.
    const { headers } = uri as unknown as { headers: Record<string, string> }

    headers[tracingHeader] = traceId
  }
})
