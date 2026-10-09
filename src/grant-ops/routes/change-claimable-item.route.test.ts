import { load } from 'cheerio'
import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'

import { currentGasActor } from '../../common/gas-actor.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { grantOps } from '../index.ts'
import type {
  ClaimableEntitlement,
  EntitlementTemplate,
  SubmittedClaim
} from '../repositories/claims.repository.ts'
import {
  findClaims,
  findEntitlement,
  updateEntitlement
} from '../repositories/claims.repository.ts'

vi.mock(import('../repositories/claims.repository.ts'))

const claimsUrl = '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims'
const url = `${claimsUrl}/entitlements/entitlement-1/change`

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantApplicationsAdmin']
}

const template = (overrides: Partial<EntitlementTemplate> = {}) =>
  ({
    claimCode: 'ENT_CS_CAPITAL_PA3',
    name: 'PA3 Woodland Management Plan entitlement',
    materialised: false,
    fields: {
      totalHectares: {
        input: true,
        label: 'Total area of eligible woodland',
        unitType: 'decimal',
        decimalPlaces: 4,
        unit: 'HA'
      }
    },
    maxEntitlements: 1,
    createdCount: 1,
    availableAt: [{ phase: 'PRE_AWARD' }],
    ...overrides
  }) as EntitlementTemplate

const entitlement = (
  overrides: Partial<ClaimableEntitlement> = {}
): ClaimableEntitlement => ({
  source: 'persisted',
  claimCode: 'ENT_CS_CAPITAL_PA3',
  name: 'PA3 Woodland Management Plan entitlement',
  description: 'Entitlement for Woodland Management Plan (PA3).',
  data: { totalHectares: { value: 12.5 } },
  entitlementId: 'entitlement-1',
  instanceNumber: 1,
  claim: {},
  canEdit: true,
  ...overrides
})

const banner = {
  title: { text: 'Elmwood Land Co', type: 'string' }
}

const submittedClaim: SubmittedClaim = {
  clientClaimRef: 'WMP-TU3-LBJ-C07',
  claimCode: 'ENT_CS_CAPITAL_PA4',
  name: 'PA4 entitlement',
  quantity: null,
  totalClaimAmountPence: 150000,
  requiresApproval: false,
  paymentScheduled: true,
  submittedAt: '2026-09-15T12:50:08.932Z'
}

const givenEntitlement = (
  overrides: Partial<ClaimableEntitlement> = {},
  others: ClaimableEntitlement[] = []
) =>
  vi.mocked(findEntitlement).mockResolvedValue({
    banner,
    availableEntitlements: [template()],
    claimableEntitlements: [entitlement(overrides), ...others],
    claims: [submittedClaim],
    claimableEntitlement: entitlement(overrides),
    entitlementTemplate: template()
  })

const viewPage = async () => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

const followRedirect = async (headers: Record<string, unknown>) => {
  const { result } = await server.inject({
    method: 'GET',
    url: headers.location as string,
    headers: { cookie: (headers['set-cookie'] as string[]).join('; ') },
    auth: { strategy: 'session', credentials }
  })

  return load(result as unknown as string)
}

const claimed =
  'PA3 Woodland Management Plan entitlement has a claim against it and cannot be changed.'

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([grantOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('changeClaimableItemRoute', () => {
  beforeEach(() => {
    givenEntitlement()
    vi.mocked(findClaims).mockResolvedValue({
      banner,
      availableEntitlements: [template()],
      claimableEntitlements: [entitlement()],
      claims: [submittedClaim]
    })
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({ method: 'GET', url })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user holding only the operations admin role', async () => {
    const { statusCode } = await server.inject({
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

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('heads the page with the application banner and the form', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="application-header-title"]').text().trim()).toBe(
      'Elmwood Land Co'
    )
    expect($('[data-testid="claimable-heading"]').text().trim()).toBe(
      'Change claimable item'
    )
    expect($('#change-entitlement form[method="post"]')).toHaveLength(1)
    expect($('[data-testid="claimable-submit"]').text().trim()).toBe(
      'Save changes'
    )
  })

  test('places the form below the awaiting claims', async () => {
    const { $ } = await viewPage()

    const order = $(
      '[data-testid="available-entitlements"], [data-testid="awaiting-claims"], #change-entitlement'
    ).map((_, el) => $(el).attr('data-testid') ?? $(el).attr('id'))

    expect(order.get()).toEqual([
      'available-entitlements',
      'awaiting-claims',
      'change-entitlement'
    ])
  })

  test('withholds the change link from the item being changed', async () => {
    givenEntitlement({}, [
      entitlement({ entitlementId: 'entitlement-2', instanceNumber: 2 })
    ])

    const { $ } = await viewPage()

    const $links = $('[data-testid="awaiting-claim-change"]')

    expect($('[data-testid="awaiting-claim"]')).toHaveLength(2)
    expect($links).toHaveLength(1)
    expect($links.attr('href')).toBe(
      `${claimsUrl}/entitlements/entitlement-2/change#change-entitlement`
    )
  })

  test('fills each input with the value the entitlement holds', async () => {
    const { $ } = await viewPage()

    expect($('#totalHectares').val()).toBe('12.5')
  })

  test('cancels back to the claims page', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="claimable-cancel"]').attr('href')).toBe(claimsUrl)
  })

  test('reads from GAS as the signed in operator', async () => {
    let actor = {}
    const item = await findEntitlement(
      'woodland',
      'WMP-1T9-RXN',
      'entitlement-1'
    )
    vi.mocked(findEntitlement).mockImplementation(async () => {
      actor = currentGasActor()
      return item
    })

    await server.inject({
      method: 'GET',
      url,
      auth: {
        strategy: 'session',
        credentials: {
          ...credentials,
          user: { name: 'Ada Lovelace', id: 'entra-object-id-1' }
        }
      }
    })

    expect(actor).toEqual({ name: 'Ada Lovelace', id: 'entra-object-id-1' })
  })

  test('asks GAS for the entitlement in the url', async () => {
    await viewPage()

    expect(findEntitlement).toHaveBeenCalledWith(
      'woodland',
      'WMP-1T9-RXN',
      'entitlement-1'
    )
  })

  test('shows the claimed list below the form', async () => {
    const { $ } = await viewPage()

    const order = $('#change-entitlement, [data-testid="claimed-claims"]').map(
      (_, el) => $(el).attr('id') ?? $(el).attr('data-testid')
    )

    expect(order.get()).toEqual(['change-entitlement', 'claimed-claims'])
  })

  test('returns to the claims page when a claim was made against the item first', async () => {
    vi.mocked(findEntitlement).mockRejectedValue(Boom.conflict(claimed))
    vi.mocked(findClaims).mockResolvedValue({
      banner,
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: [submittedClaim]
    })

    const { headers, statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)

    const $ = await followRedirect(headers)

    expect($('[data-testid="entitlement-refused"]').text()).toContain(
      `This item cannot be changed: ${claimed}`
    )
    expect($('title').text()).toContain('Error: Claims')
  })

  test('is not found for a grant with no claims page configured', async () => {
    vi.mocked(findEntitlement).mockResolvedValue({
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: [],
      claimableEntitlement: entitlement(),
      entitlementTemplate: template()
    })

    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('is not found for an entitlement that is not awaiting a claim', async () => {
    vi.mocked(findEntitlement).mockRejectedValue(Boom.notFound('not awaiting'))

    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

const gasRefusal = (statusCode: number, message: string, errorCode?: string) =>
  Object.assign(new Error('Response Error'), {
    isBoom: true,
    output: { statusCode },
    data: { payload: { statusCode, message, errorCode } }
  })

const configurationChanged =
  "Grant configuration for 'woodland' changed while updating the entitlement. Try again."

describe('updateClaimableItemRoute', () => {
  beforeEach(() => {
    givenEntitlement()
    vi.mocked(findClaims).mockResolvedValue({
      banner,
      availableEntitlements: [],
      claimableEntitlements: [],
      claims: [submittedClaim]
    })
    vi.mocked(updateEntitlement).mockResolvedValue()
  })

  const post = (payload: Record<string, string>) =>
    server.inject({
      method: 'POST',
      url,
      payload,
      auth: { strategy: 'session', credentials }
    })

  test('sends the scaled values to GAS', async () => {
    await post({ totalHectares: ' 45.5 ' })

    expect(updateEntitlement).toHaveBeenCalledWith({
      clientRef: 'WMP-1T9-RXN',
      grantCode: 'woodland',
      entitlementId: 'entitlement-1',
      data: { totalHectares: { value: 455000 } }
    })
  })

  test('updates the entitlement as the signed in operator', async () => {
    let actor = {}
    vi.mocked(updateEntitlement).mockImplementation(async () => {
      actor = currentGasActor()
    })

    await post({ totalHectares: '45.5' })

    expect(actor).toMatchObject({ name: 'Ada Lovelace' })
  })

  test('returns to the claims page and says what changed', async () => {
    const { headers, statusCode } = await post({ totalHectares: '45.5' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)

    const { result } = await server.inject({
      method: 'GET',
      url: headers.location as string,
      headers: { cookie: (headers['set-cookie'] as string[]).join('; ') },
      auth: { strategy: 'session', credentials }
    })

    const $banner = load(result as unknown as string)(
      '[data-testid="entitlement-updated"]'
    )

    expect(
      $banner.find('.govuk-notification-banner__heading').text().trim()
    ).toBe('Claimable item changed')
    expect($banner.find('p').text().trim()).toBe(
      'PA3 Woodland Management Plan entitlement changed to 45.5 ha.'
    )
  })

  test('keeps the entered value and does not reach GAS when it fails validation', async () => {
    const { result, statusCode } = await post({ totalHectares: '' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect($('[data-testid="claimable-error-summary"] a').text().trim()).toBe(
      'Enter total area of eligible woodland'
    )
    expect($('#change-entitlement')).toHaveLength(1)
    expect(updateEntitlement).not.toHaveBeenCalled()
  })

  test('explains a refusal from GAS on the form', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(422, "Field 'totalHectares' has an invalid value")
    )

    const { result, statusCode } = await post({ totalHectares: '40.25' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(422)
    expect(
      $('[data-testid="claimable-error-summary"]').text().replace(/\s+/g, ' ')
    ).toContain(
      "This item cannot be changed: Field 'totalHectares' has an invalid value. Please try again."
    )
    expect($('#totalHectares').attr('value')).toBe('40.25')
  })

  test('returns to the claims page when a claim lands before the save', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(409, claimed, 'ENTITLEMENT_CLAIMED')
    )

    const { headers, statusCode } = await post({ totalHectares: '40.25' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)

    const $ = await followRedirect(headers)

    expect($('[data-testid="entitlement-refused"]').text()).toContain(
      `This item cannot be changed: ${claimed}`
    )
  })

  test('keeps the form and the entered values when the configuration changed under the save', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(409, configurationChanged, 'CONFIGURATION_CHANGED')
    )

    const { result, statusCode } = await post({ totalHectares: '40.25' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.conflict)
    expect($('#change-entitlement form[method="post"]')).toHaveLength(1)
    expect($('#totalHectares').attr('value')).toBe('40.25')
    expect(
      $('[data-testid="claimable-error-summary"]').text().replace(/\s+/g, ' ')
    ).toContain(`This item cannot be changed: ${configurationChanged}`)
  })

  test('shows the refreshed template when the configuration changed under the save', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(409, configurationChanged, 'CONFIGURATION_CHANGED')
    )
    vi.mocked(findEntitlement)
      .mockResolvedValueOnce({
        banner,
        availableEntitlements: [template()],
        claimableEntitlements: [entitlement()],
        claims: [submittedClaim],
        claimableEntitlement: entitlement(),
        entitlementTemplate: template()
      })
      .mockResolvedValueOnce({
        banner,
        availableEntitlements: [template()],
        claimableEntitlements: [entitlement()],
        claims: [submittedClaim],
        claimableEntitlement: entitlement(),
        entitlementTemplate: template({
          fields: {
            totalHectares: {
              input: true,
              label: 'Eligible woodland area',
              unitType: 'decimal',
              decimalPlaces: 4,
              unit: 'HA'
            }
          }
        })
      })

    const { result } = await post({ totalHectares: '40.25' })
    const $ = load(result as unknown as string)

    expect(findEntitlement).toHaveBeenCalledTimes(2)
    expect($('label[for="totalHectares"]').text().trim()).toBe(
      'Eligible woodland area'
    )
    expect($('#totalHectares').attr('value')).toBe('40.25')
  })

  test('returns to the claims page when the configuration changed and a claim has landed since', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(409, configurationChanged, 'CONFIGURATION_CHANGED')
    )
    vi.mocked(findEntitlement)
      .mockResolvedValueOnce({
        banner,
        availableEntitlements: [template()],
        claimableEntitlements: [entitlement()],
        claims: [],
        claimableEntitlement: entitlement(),
        entitlementTemplate: template()
      })
      .mockRejectedValueOnce(gasRefusal(409, claimed, 'ENTITLEMENT_CLAIMED'))

    const { headers, statusCode } = await post({ totalHectares: '40.25' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)

    const $ = await followRedirect(headers)

    expect($('[data-testid="entitlement-refused"]').text()).toContain(
      `This item cannot be changed: ${claimed}`
    )
  })

  test('shows the refusal once and not on the next visit', async () => {
    vi.mocked(updateEntitlement).mockRejectedValue(
      gasRefusal(409, 'It has a claim against it')
    )

    const { headers } = await post({ totalHectares: '40.25' })

    await followRedirect(headers)
    const $ = await followRedirect(headers)

    expect($('[data-testid="entitlement-refused"]')).toHaveLength(0)
    expect($('title').text()).not.toContain('Error')
  })

  test('returns to the claims page when a claim was made before the form was sent', async () => {
    vi.mocked(findEntitlement).mockRejectedValue(Boom.conflict(claimed))

    const { headers, statusCode } = await post({ totalHectares: '40.25' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)
    expect(updateEntitlement).not.toHaveBeenCalled()
  })
})
