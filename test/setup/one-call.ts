import { pendingOneCall } from '../../src/dev-ops/one-call.pending.ts'
import { setExtraCallsHandler } from '../../src/dev-ops/upstream.ts'

/** A route that makes a second GAS call fails its response, unless it is one still waiting on its own change. */
beforeAll(() => {
  setExtraCallsHandler((_request, route) => {
    if (!pendingOneCall.includes(route)) {
      throw new Error(`${route} made more than one call to fg-gas-backend`)
    }
  })
})
