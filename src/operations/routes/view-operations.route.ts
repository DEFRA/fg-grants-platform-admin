import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

// The scope is an app role name as assigned on the Entra ID application
// registration. Hapi turns away a user without it, so the handler only ever
// runs for one who holds it.
export const viewOperationsRoute: ServerRoute = {
  method: 'GET',
  path: '/operations',
  options: {
    auth: {
      strategy: 'session',
      scope: ['FCP.GrantOperationsAdmin']
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    return h.view('index', {
      pageTitle: 'Operations Admin',
      heading: 'Operations Admin',
      name: request.auth.credentials.user.name
    })
  }
}
