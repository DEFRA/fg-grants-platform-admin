import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { load } from 'cheerio'

import { currentGasActor } from '../../common/gas-actor.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { grantOps } from '../index.ts'
import { getHome } from '../repositories/home.repository.ts'

vi.mock(import('../repositories/home.repository.ts'))

const url = '/grant-ops'

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

const forbidden = async (scope: string[]) => {
  const { statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: {
      strategy: 'session',
      credentials: { user: { name: 'Ada Lovelace' }, scope }
    }
  })

  return statusCode
}

describe('viewGrantOpsRoute', () => {
  beforeEach(() => {
    vi.mocked(getHome).mockResolvedValue({ grantTypeCount: 4 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({ method: 'GET', url })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(getHome).not.toHaveBeenCalled()
  })

  test('forbids a signed in user holding only the operations admin role', async () => {
    expect(await forbidden(['FCP.GrantOperationsAdmin'])).toBe(
      statusCodes.forbidden
    )
    expect(getHome).not.toHaveBeenCalled()
  })

  test('forbids a signed in user holding no roles', async () => {
    expect(await forbidden([])).toBe(statusCodes.forbidden)
    expect(getHome).not.toHaveBeenCalled()
  })

  test('reads the home view as the signed-in operator', async () => {
    let actor = {}
    vi.mocked(getHome).mockImplementation(async () => {
      actor = currentGasActor()
      return { grantTypeCount: 4 }
    })

    await viewPage()

    expect(actor).toMatchObject({ name: 'Ada Lovelace', id: 'operator-1' })
  })

  test('shows the Manage grants heading', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('h1').text().trim()).toBe('Manage grants')
    expect($('title').text()).toContain('Manage grants')
  })

  test('links the Grant types card to the Grant Types page and counts the grant types', async () => {
    const { $ } = await viewPage()
    const card = $('[data-testid="grant-types-card"]')

    expect(card.find('h2 a').text().trim()).toBe('Grant types')
    expect(card.find('h2 a').attr('href')).toBe('/grant-ops/grants')
    expect(card.find('p').text().trim()).toBe(
      'Browse the 4 grant schemes and manage scheme parameters'
    )
  })

  test('shows the Grant applications card with a placeholder link', async () => {
    const { $ } = await viewPage()
    const card = $('[data-testid="grant-applications-card"]')

    expect(card.find('h2 a').text().trim()).toBe('Grant applications')
    expect(card.find('h2 a').attr('href')).toBe('#')
    expect(card.find('p')).toHaveLength(0)
  })

  test('shows the cards side by side, in order', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="home-cards"] > .govuk-grid-column-one-half h2')
        .map((_, h2) => $(h2).text().trim())
        .get()
    ).toEqual(['Grant types', 'Grant applications'])
  })

  test('still offers the operator a way to sign out', async () => {
    const { $ } = await viewPage()
    const body = $('[data-testid="app-page-body"]')

    expect(body.text()).toContain('Signed in as Ada Lovelace.')
    expect(body.find('a').attr('href')).toBe('/auth/logout')
  })

  test.each([
    ['GAS fails', gasError(500)],
    [
      'GAS cannot determine the roles',
      gasError(503, { errorCode: 'CASEWORKING_ROLES_UNAVAILABLE' })
    ],
    ['GAS cannot be reached', new Error('ECONNREFUSED')]
  ])(
    'still shows the page without a count, and logs, when %s',
    async (_, error) => {
      vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.mocked(getHome).mockRejectedValue(error)

      const { statusCode, $ } = await viewPage()

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe('Manage grants')
      expect($('[data-testid="grant-types-card"] p').text().trim()).toBe(
        'Browse the grant schemes and manage scheme parameters'
      )
      expect(
        $('[data-testid="grant-applications-card"] h2 a').text().trim()
      ).toBe('Grant applications')
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          'Could not read the grant type count from fg-gas-backend'
        )
      )
    }
  )
})
