import type { ResponseToolkit, ServerRoute } from '@hapi/hapi'

/**
 * Found rather than moved permanently: a browser caches a 301 indefinitely and
 * would go on skipping this path long after the app had something else to say
 * here.
 */
export const viewDevOpsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops',
  handler(_request: unknown, h: ResponseToolkit) {
    return h.redirect('/dev-ops/events')
  }
}
