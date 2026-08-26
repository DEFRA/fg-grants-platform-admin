import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

export const viewOperationsRoute: ServerRoute = {
  method: 'GET',
  path: '/operations',
  handler(request: Request, h: ResponseToolkit) {
    return h.view('index', {
      pageTitle: 'Operations Admin',
      heading: 'Operations Admin',
      name: request.auth.credentials.user.name
    })
  }
}
