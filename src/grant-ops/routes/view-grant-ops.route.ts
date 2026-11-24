import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

import { getHomeUseCase } from '../use-cases/get-home.use-case.ts'
import { toHomePage } from '../view-models/home-page.view-model.ts'

export const viewGrantOpsRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops',
  async handler(request: Request, h: ResponseToolkit) {
    const home = await getHomeUseCase()

    return h.view('index', toHomePage(home, request.auth.credentials.user.name))
  }
}
