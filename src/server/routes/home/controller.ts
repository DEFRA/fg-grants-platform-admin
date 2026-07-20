import type { ResponseToolkit } from '@hapi/hapi'

/**
 * A GDS styled example home page controller.
 * Provided as an example, remove or modify as required.
 */
export const homeController = {
  handler(_request: unknown, h: ResponseToolkit) {
    return h.view('home/index', {
      pageTitle: 'Home',
      heading: 'Home'
    })
  }
}
