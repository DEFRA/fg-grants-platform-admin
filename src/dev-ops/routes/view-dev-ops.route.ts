import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

export const viewDevOpsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops',
  handler(request: Request, h: ResponseToolkit) {
    return h.view('index', {
      pageTitle: 'Operations Admin',
      name: request.auth.credentials.user.name
    })
  }
}
