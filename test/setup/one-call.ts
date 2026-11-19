import { setExtraCallsHandler } from '../../src/dev-ops/upstream.ts'

/** A route that makes a second GAS call fails its response. */
beforeAll(() => {
  setExtraCallsHandler((_request, route) => {
    throw new Error(`${route} made more than one call to fg-gas-backend`)
  })
})
