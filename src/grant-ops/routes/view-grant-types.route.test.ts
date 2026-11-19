import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { currentGasActor } from '../../common/gas-actor.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'
import { getGrantTypes } from '../repositories/grant-types.repository.ts'

vi.mock(import('../repositories/grant-types.repository.ts'))

const url = '/grant-ops/grants'
const unavailable =
  'Caseworking roles could not be determined — try again later'

const credentials = {
  user: { name: 'Ada Lovelace', id: 'operator-1' },
  scope: ['FCP.GrantApplicationsAdmin']
}

const authenticated = { strategy: 'session', credentials } as const

/** A wreck-thrown non-2xx, matching what @hapi/wreck attaches to the error. */
const gasError = (statusCode: number, payload?: object) =>
  Object.assign(Boom.boomify(new Error('Response Error'), { statusCode }), {
    data: { payload }
  })

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([grantOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

const viewPage = async () => {
  const response = await server.inject({
    method: 'GET',
    url,
    auth: authenticated
  })

  return { ...response, $: load(response.result as unknown as string) }
}

describe('viewGrantTypesRoute', () => {
  beforeEach(() => {
    vi.mocked(getGrantTypes).mockResolvedValue({
      grantTypes: [
        { code: 'fptt', name: 'Farming Payments' },
        { code: 'woodland', name: 'Woodland Management Plan' }
      ]
    })
  })

  test('redirects an anonymous user to login', async () => {
    const response = await server.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(statusCodes.found)
    expect(response.headers.location).toBe('/auth/login')
    expect(getGrantTypes).not.toHaveBeenCalled()
  })

  test('forbids a user without the applications admin role', async () => {
    const response = await server.inject({
      method: 'GET',
      url,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(response.statusCode).toBe(statusCodes.forbidden)
    expect(getGrantTypes).not.toHaveBeenCalled()
  })

  test('reads the grant types as the signed-in operator', async () => {
    let actor = {}
    vi.mocked(getGrantTypes).mockImplementation(async () => {
      actor = currentGasActor()
      return { grantTypes: [] }
    })

    await viewPage()

    expect(actor).toMatchObject({ name: 'Ada Lovelace', id: 'operator-1' })
  })

  test('shows the Grant Types heading', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('h1').text().trim()).toBe('Grant Types')
    expect($('title').text()).toContain('Grant Types')
  })

  test('lists the grant types with Grant Code, Grant Name and Status columns, in that order', async () => {
    const { $ } = await viewPage()
    const table = $('[data-testid="grant-types"]')

    expect(
      table
        .find('thead th')
        .map((_, th) => $(th).text().trim())
        .get()
    ).toEqual(['Grant Code', 'Grant Name', 'Status'])
    expect(
      table
        .find('tbody tr')
        .map((_, tr) => [
          $(tr)
            .find('td')
            .map((__, td) => $(td).text().trim())
            .get()
        ])
        .get()
    ).toEqual([
      ['fptt', 'Farming Payments', '[Status]'],
      ['woodland', 'Woodland Management Plan', '[Status]']
    ])
  })

  test('links each grant code to its admin page', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="grant-types"] tbody a')
        .map((_, a) => $(a).attr('href'))
        .get()
    ).toEqual([
      '/grant-ops/grants/fptt/admin',
      '/grant-ops/grants/woodland/admin'
    ])
  })

  test('shows each status as a tag', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="grant-types"] .govuk-tag')).toHaveLength(2)
  })

  test('escapes a grant code in its link and text', async () => {
    vi.mocked(getGrantTypes).mockResolvedValue({
      grantTypes: [{ code: '<b>x</b>', name: '<i>y</i>' }]
    })

    const { result, $ } = await viewPage()

    expect(result).not.toContain('<b>x</b>')
    expect(result).not.toContain('<i>y</i>')
    expect($('[data-testid="grant-types"] tbody a').attr('href')).toBe(
      '/grant-ops/grants/%3Cb%3Ex%3C%2Fb%3E/admin'
    )
  })

  test('says there are no grant types available when the operator administers none', async () => {
    vi.mocked(getGrantTypes).mockResolvedValue({ grantTypes: [] })

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="grant-types"]')).toHaveLength(0)
    expect($('[data-testid="no-grant-types"]').text()).toContain(
      'There are no grant types available.'
    )
  })

  test('explains that GAS could not determine the roles', async () => {
    vi.mocked(getGrantTypes).mockRejectedValue(
      gasError(503, { errorCode: 'CASEWORKING_ROLES_UNAVAILABLE' })
    )

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect($('body').text()).toContain(unavailable)
  })

  test.each([500, 502, 503])(
    'shows the error page when GAS fails with %i',
    async (statusCode) => {
      vi.mocked(getGrantTypes).mockRejectedValue(gasError(statusCode))

      const response = await viewPage()

      expect(response.statusCode).toBe(statusCode)
      expect(response.$('body').text()).toContain('Something went wrong')
      expect(response.$('body').text()).not.toContain(unavailable)
    }
  )

  test('shows the error page when GAS cannot be reached', async () => {
    vi.mocked(getGrantTypes).mockRejectedValue(new Error('ECONNREFUSED'))

    const response = await viewPage()

    expect(response.statusCode).toBe(statusCodes.internalServerError)
    expect(response.$('body').text()).toContain('Something went wrong')
  })
})
