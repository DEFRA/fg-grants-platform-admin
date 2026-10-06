import type { ResponseToolkit, ServerRoute } from '@hapi/hapi'

import { applicationsPath } from '../view-models/applications-page.view-model.ts'

/**
 * Found rather than moved permanently: a browser caches a 301 indefinitely and
 * would go on skipping this path long after the app had something else to say
 * here.
 */
export const viewDevOpsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops',
  handler(_request: unknown, h: ResponseToolkit) {
    return h.redirect(applicationsPath)
  }
}
