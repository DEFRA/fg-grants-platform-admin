import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

export const viewApplicationsRoute: ServerRoute = {
  method: 'GET',
  path: '/applications',
  options: {
    auth: {
      strategy: 'session',
      scope: ['FCP.GrantApplicationsAdmin']
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    return h.view('index', {
      pageTitle: 'Applications Admin',
      heading: 'Applications Admin',
      name: request.auth.credentials.user.name
    })
  }
}
