import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

export const viewGrantOpsRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops',
  handler(request: Request, h: ResponseToolkit) {
    return h.view('index', {
      pageTitle: 'Applications Admin',
      heading: 'Applications Admin',
      name: request.auth.credentials.user.name
    })
  }
}
