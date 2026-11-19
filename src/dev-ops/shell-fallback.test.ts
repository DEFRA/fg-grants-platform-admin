import Boom from '@hapi/boom'
import type { Request, ResponseToolkit } from '@hapi/hapi'

import { fetchMissingShell } from './shell-fallback.ts'
import { readShellUseCase } from './use-cases/shell-catalogue.ts'
import { currentGasActor } from '../common/gas-actor.ts'
import { currentUpstream, type Upstream } from './upstream.ts'

vi.mock(import('./use-cases/shell-catalogue.ts'))

const operator = { scope: ['FCP.GrantOperationsAdmin'] }

const h = { continue: Symbol('continue') } as unknown as ResponseToolkit

const view = (statusCode: number) => ({ variety: 'view', statusCode })

const shell = { catalogue: { buckets: [], sourceErrors: [] } }

interface Given {
  response?: unknown
  credentials?: object | null
  upstream?: Upstream
}

const page: Required<Given> = {
  response: view(200),
  credentials: operator,
  upstream: { calls: 0, shell: null }
}

const requestOf = (given: Given = {}) => {
  const { response, credentials, upstream } = { ...page, ...given }

  return {
    response,
    auth: { credentials },
    app: { upstream: { ...upstream } }
  } as unknown as Request
}

describe('fetchMissingShell', () => {
  test.each([
    ['a page', view(200)],
    ['a 404', Boom.notFound()],
    ['a 400 drawn as a page', view(400)]
  ])(
    'asks GAS for the shell once for %s drawn without a call',
    async (_name, response) => {
      await expect(fetchMissingShell(requestOf({ response }), h)).resolves.toBe(
        h.continue
      )

      expect(readShellUseCase).toHaveBeenCalledTimes(1)
    }
  )

  test('asks inside the request’s own store, so the call is counted and the shell kept, as the operator', async () => {
    const request = requestOf({
      credentials: { ...operator, user: { id: 'entra-id', name: 'Ada' } }
    })
    let during: unknown = null
    vi.mocked(readShellUseCase).mockImplementationOnce(async () => {
      during = { upstream: currentUpstream(), actor: currentGasActor() }
    })

    await fetchMissingShell(request, h)

    expect(during).toEqual({
      upstream: request.app.upstream,
      actor: { name: 'Ada', id: 'entra-id' }
    })
  })

  test.each([
    ['a 500', Boom.badImplementation()],
    ['a 500 page', view(500)],
    ['a redirect', { variety: 'plain', statusCode: 302 }]
  ])('asks nothing for %s', async (_name, response) => {
    await fetchMissingShell(requestOf({ response }), h)

    expect(readShellUseCase).not.toHaveBeenCalled()
  })

  test.each([
    ['signed out', null],
    ['without the role', { scope: ['FCP.GrantApplicationsAdmin'] }],
    ['with no scope', {}]
  ])('asks nothing for someone %s', async (_name, credentials) => {
    await fetchMissingShell(requestOf({ credentials }), h)

    expect(readShellUseCase).not.toHaveBeenCalled()
  })

  test.each([
    ['made a call, answered or not', { calls: 1, shell: null }],
    ['has the shell already', { calls: 0, shell }]
  ])('asks nothing for a page that %s', async (_name, upstream) => {
    await fetchMissingShell(requestOf({ upstream }), h)

    expect(readShellUseCase).not.toHaveBeenCalled()
  })
})
