import type {
  Lifecycle,
  Request,
  ResponseToolkit,
  ServerRoute
} from '@hapi/hapi'

import { asGasActor } from '../common/gas-actor.ts'
import { toGasActor } from './view-models/actor.ts'

/**
 * Runs each handler as the signed in operator, so every GAS call it makes
 * names them, without each route and use case passing them along.
 */
export const asOperator = (routes: ServerRoute[]): ServerRoute[] =>
  routes.map((route) => {
    const handler = route.handler as Lifecycle.Method

    return {
      ...route,
      handler(this: object | null, request: Request, h: ResponseToolkit) {
        return asGasActor(toGasActor(request), () =>
          handler.call(this, request, h)
        )
      }
    }
  })
