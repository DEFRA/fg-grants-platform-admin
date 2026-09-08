import type { ServerRoute } from '@hapi/hapi'

import { scopedTo } from './scoped-to.ts'

const handler = () => 'ok'

describe('scopedTo', () => {
  test('scopes a route that names no auth of its own', () => {
    const [route] = scopedTo('FCP.GrantApplicationsAdmin', [
      { method: 'GET', path: '/grant-ops', handler }
    ])

    expect(route.options).toMatchObject({
      auth: { strategy: 'session', scope: ['FCP.GrantApplicationsAdmin'] }
    })
  })

  test('keeps the other options of a scoped route', () => {
    const [route] = scopedTo('FCP.GrantApplicationsAdmin', [
      { method: 'GET', path: '/grant-ops', options: { id: 'a' }, handler }
    ])

    expect(route.options).toMatchObject({
      id: 'a',
      auth: { strategy: 'session', scope: ['FCP.GrantApplicationsAdmin'] }
    })
  })

  test('leaves a route naming its own auth alone', () => {
    const auth = { strategy: 'session', scope: ['FCP.GrantOperationsAdmin'] }

    const [route] = scopedTo('FCP.GrantApplicationsAdmin', [
      { method: 'GET', path: '/grant-ops', options: { auth }, handler }
    ] as ServerRoute[])

    expect(route.options).toMatchObject({ auth })
  })
})
