import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { operations } from '../index.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'

vi.mock(import('../use-cases/get-claims.use-case.ts'))

const url = '/grant-ops/grants/woodland/applications/wood-1001/claims'

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const template = {
  claimCode: 'ENT_CS_CAPITAL_PA3',
  name: 'PA3 Woodland Management Plan entitlement',
  description: 'The maximum eligible woodland area that can be claimed.',
  materialised: false,
  maxEntitlements: 1,
  availableAt: {
    phase: 'PHASE_PRE_AWARD',
    stage: 'STAGE_PREPARE_CLAIM',
    status: 'STATUS_PREPARING_CLAIM'
  }
}

const givenClaims = (overrides = {}) =>
  vi.mocked(getClaimsUseCase).mockResolvedValue({
    availableEntitlements: [],
    claimableEntitlements: [],
    claims: [],
    ...overrides
  })

describe('viewClaimsRoute', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.register([operations])
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({ method: 'GET', url })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user holding only the applications admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('asks the backend for the claims of the requested application', async () => {
    givenClaims()

    await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(getClaimsUseCase).toHaveBeenCalledWith('woodland', 'wood-1001')
  })

  test('displays the available entitlements as pretty printed json', async () => {
    givenClaims({ availableEntitlements: [template] })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('&quot;claimCode&quot;'))
    expect(result).toEqual(expect.stringContaining('ENT_CS_CAPITAL_PA3'))
    expect(result).toEqual(
      expect.stringContaining('PA3 Woodland Management Plan entitlement')
    )
    expect(result).toEqual(expect.stringContaining('STATUS_PREPARING_CLAIM'))
  })

  test('indents the json', async () => {
    givenClaims({ availableEntitlements: [template] })

    const { result } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(result).toEqual(
      expect.stringContaining('\n  &quot;claimCode&quot;: ')
    )
  })

  test('labels each available entitlement with its claim code', async () => {
    givenClaims({
      availableEntitlements: [
        template,
        { ...template, claimCode: 'ENT_CS_CAPITAL_PA4' }
      ]
    })

    const { result } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    const html = result as unknown as string

    expect(
      html.match(/data-testid="available-entitlement-claim-code"/g)
    ).toHaveLength(2)
    expect(html.match(/data-testid="available-entitlement"/g)).toHaveLength(2)
    expect(html).toEqual(
      expect.stringContaining(
        '<h3 class="govuk-heading-s" data-testid="available-entitlement-claim-code">ENT_CS_CAPITAL_PA3</h3>'
      )
    )
    expect(html).toEqual(
      expect.stringContaining(
        '<h3 class="govuk-heading-s" data-testid="available-entitlement-claim-code">ENT_CS_CAPITAL_PA4</h3>'
      )
    )
  })

  test('titles the page Claims', async () => {
    givenClaims()

    const { result } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(result).toEqual(expect.stringContaining('Claims |'))
    expect(result).not.toEqual(expect.stringContaining('Claims for wood-1001'))
  })

  test('tells the user when nothing is available', async () => {
    givenClaims()

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('No entitlements are available')
    )
  })

  test('displays the claimable entitlements and claims as json', async () => {
    givenClaims({ claimableEntitlements: [{ ref: 'ENT-1' }], claims: [] })

    const { result } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(result).toEqual(expect.stringContaining('ENT-1'))
    expect(result).toEqual(expect.stringContaining('data-testid="claims"'))
  })
})
