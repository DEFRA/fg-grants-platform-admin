import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { grantOps } from '../index.ts'
import type { EntitlementTemplate } from '../use-cases/get-claims.use-case.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'

vi.mock(import('../use-cases/get-claims.use-case.ts'))
vi.mock(import('../repositories/claims.repository.ts'))

const claimsUrl = '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims'
const url = `${claimsUrl}/new-entitlement/ENT_CS_CAPITAL_PA3`

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantApplicationsAdmin']
}

const template = (overrides: Partial<EntitlementTemplate> = {}) =>
  ({
    claimCode: 'ENT_CS_CAPITAL_PA3',
    name: 'PA3 Woodland Management Plan entitlement',
    description: 'The maximum eligible woodland area that can be claimed.',
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
    availableAt: { phase: 'PRE_AWARD' },
    ...overrides
  }) as EntitlementTemplate

const banner = {
  title: { text: 'Elmwood Land Co', type: 'string' },
  summary: {
    sbi: { label: 'SBI', text: '113598882', type: 'string' }
  }
}

const givenClaims = (availableEntitlements: EntitlementTemplate[] = []) =>
  vi.mocked(getClaimsUseCase).mockResolvedValue({
    banner,
    availableEntitlements,
    claimableEntitlements: [],
    claims: []
  })

const viewPage = async () => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([grantOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('newClaimableItemRoute', () => {
  beforeEach(() => {
    givenClaims([template()])
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

  test('heads the page with the application banner and tabs', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="application-header-title"]').text().trim()).toBe(
      'Elmwood Land Co'
    )
    expect($('.app-application-tabs')).toHaveLength(1)
  })

  test('lists the available entitlements above the form', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="available-entitlements"]')).toHaveLength(1)
    expect($('[data-testid="available-entitlement"]')).toHaveLength(1)

    const order = $(
      '[data-testid="available-entitlements"], #new-entitlement'
    ).map((_, el) => $(el).attr('data-testid') ?? $(el).attr('id'))

    expect(order.get()).toEqual(['available-entitlements', 'new-entitlement'])
  })

  test('withholds the create link from the entitlement being created', async () => {
    givenClaims([
      template(),
      template({ claimCode: 'ENT_CS_CAPITAL_PA4', name: 'PA4 entitlement' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="available-entitlement"]')).toHaveLength(2)

    const $links = $('[data-testid="available-entitlement-create"]')

    expect($links).toHaveLength(1)
    expect($links.attr('href')).toBe(
      `${claimsUrl}/new-entitlement/ENT_CS_CAPITAL_PA4#new-entitlement`
    )
  })

  test('anchors the form so the page opens at it', async () => {
    const { $ } = await viewPage()

    const $form = $('#new-entitlement')

    expect($form).toHaveLength(1)
    expect($form.find('form[method="post"]')).toHaveLength(1)
  })

  test('renders an input for each field the template collects', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="claimable-field-totalHectares"]')).toHaveLength(1)
    expect($('#totalHectares').attr('type')).toBe('number')
    expect($('#totalHectares').attr('inputmode')).toBe('decimal')
    expect($('label[for="totalHectares"]').hasClass('govuk-label--s')).toBe(
      true
    )
    expect($('[data-testid="claimable-submit"]').text().trim()).toBe(
      'Save item'
    )
  })

  test('heads the form and names the entitlement it adds', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="claimable-heading"]').text().trim()).toBe(
      'Add claimable item'
    )
    expect(
      $('[data-testid="claimable-template-description"]').text().trim()
    ).toBe('The maximum eligible woodland area that can be claimed.')
  })

  test('expands the guidance the grant definition carries', async () => {
    givenClaims([
      template({
        help: {
          summary: 'How is the claim amount calculated?',
          content: [
            { text: 'Threshold payments for eligible land in hectares (ha):' },
            { items: ['0.5ha to 50ha: flat rate of £1,500', 'more than 100ha'] }
          ]
        }
      })
    ])

    const { $ } = await viewPage()

    const $help = $('[data-testid="claimable-help"]')

    expect($help.find('.govuk-details__summary-text').text().trim()).toBe(
      'How is the claim amount calculated?'
    )
    expect($help.find('p').text().trim()).toBe(
      'Threshold payments for eligible land in hectares (ha):'
    )
    expect(
      $help
        .find('.govuk-list--bullet li')
        .map((_, item) => $(item).text().trim())
        .get()
    ).toEqual(['0.5ha to 50ha: flat rate of £1,500', 'more than 100ha'])
  })

  test('leaves out the guidance when the grant carries none', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="claimable-help"]')).toHaveLength(0)
  })

  test('offers a cancel link back to the claims page', async () => {
    const { $ } = await viewPage()

    const $cancel = $('[data-testid="claimable-cancel"]')

    expect($cancel.text().trim()).toBe('Cancel')
    expect($cancel.attr('href')).toBe(claimsUrl)
    expect($cancel.closest('form')).toHaveLength(1)
  })

  test('refuses a claim code that has reached its maximum', async () => {
    givenClaims([template({ createdCount: 1, maxEntitlements: 1 })])

    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('refuses a grant with no claims page configured', async () => {
    vi.mocked(getClaimsUseCase).mockResolvedValue({
      availableEntitlements: [template()],
      claimableEntitlements: [],
      claims: []
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('refuses a claim code that is not available', async () => {
    givenClaims([template({ claimCode: 'ENT_SOMETHING_ELSE' })])

    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('createClaimableItemRoute', () => {
  const post = (payload: Record<string, string>) =>
    server.inject({
      method: 'POST',
      url,
      payload,
      auth: { strategy: 'session', credentials }
    })

  const bounded = () =>
    template({
      fields: {
        totalHectares: {
          input: true,
          label: 'Total area of eligible woodland',
          unitType: 'decimal',
          decimalPlaces: 4,
          unit: 'HA',
          minValue: 0.5,
          maxValue: null
        }
      }
    })

  beforeEach(() => {
    givenClaims([bounded()])
  })

  test('creates the entitlement and returns to the claims page', async () => {
    const { statusCode, headers } = await post({ totalHectares: '40.25' })

    expect(createEntitlement).toHaveBeenCalledWith({
      clientRef: 'WMP-1T9-RXN',
      grantCode: 'woodland',
      claimCode: 'ENT_CS_CAPITAL_PA3',
      data: { totalHectares: { value: 40.25 } }
    })
    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(claimsUrl)
  })

  test('posts the payload the persistence service expects', async () => {
    await post({ totalHectares: ' 455000 ' })

    const [payload] = vi.mocked(createEntitlement).mock.calls[0]

    expect(payload).toEqual({
      clientRef: 'WMP-1T9-RXN',
      grantCode: 'woodland',
      claimCode: 'ENT_CS_CAPITAL_PA3',
      data: { totalHectares: { value: 455000 } }
    })
  })

  test('announces the entitlement on the claims page it returns to', async () => {
    const { headers } = await post({ totalHectares: '111' })

    const { result } = await server.inject({
      method: 'GET',
      url: headers.location as string,
      headers: { cookie: (headers['set-cookie'] as string[]).join('; ') },
      auth: { strategy: 'session', credentials }
    })

    const $ = load(result as unknown as string)
    const $banner = $('[data-testid="entitlement-created"]')

    expect(
      $banner.find('.govuk-notification-banner__title').text().trim()
    ).toBe('Success')
    expect(
      $banner.find('.govuk-notification-banner__heading').text().trim()
    ).toBe('Entitlement created')
    expect($banner.find('p').text().replace(/\s+/g, ' ').trim()).toBe(
      'PA3 Woodland Management Plan entitlement of 111 ha created. It is now awaiting a claim.'
    )
  })

  test('shows the banner once and not on the next visit', async () => {
    const { headers } = await post({ totalHectares: '111' })
    const cookie = (headers['set-cookie'] as string[]).join('; ')

    const visit = async () =>
      server.inject({
        method: 'GET',
        url: headers.location as string,
        headers: { cookie },
        auth: { strategy: 'session', credentials }
      })

    await visit()
    const { result } = await visit()

    expect(
      load(result as unknown as string)('[data-testid="entitlement-created"]')
    ).toHaveLength(0)
  })

  test('does not reach the backend when a value fails validation', async () => {
    await post({ totalHectares: '-100' })

    expect(createEntitlement).not.toHaveBeenCalled()
  })

  test('re-renders the form with the error against the field', async () => {
    const { result, statusCode } = await post({ totalHectares: '-100' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      $('.govuk-error-message').text().replace(/\s+/g, ' ').trim()
    ).toContain('Total area of eligible woodland must be 0.5 or greater')
  })

  test('keeps what was typed so it can be corrected', async () => {
    const { result } = await post({ totalHectares: '-100' })
    const $ = load(result as unknown as string)

    expect($('#totalHectares').attr('value')).toBe('-100')
  })

  test('summarises the errors and links each to its field', async () => {
    const { result } = await post({ totalHectares: '-100' })
    const $ = load(result as unknown as string)

    const $summary = $('[data-testid="claimable-error-summary"]')

    expect($summary.find('.govuk-error-summary__title').text().trim()).toBe(
      'There is a problem'
    )
    expect($summary.find('a').attr('href')).toBe('#totalHectares')
  })

  test('still shows the table and the guidance alongside the errors', async () => {
    const { result } = await post({ totalHectares: '' })
    const $ = load(result as unknown as string)

    expect($('[data-testid="available-entitlements"]')).toHaveLength(1)
    expect($('[data-testid="claimable-heading"]').text().trim()).toBe(
      'Add claimable item'
    )
  })

  test('asks for a value when the field is left blank', async () => {
    const { result, statusCode } = await post({ totalHectares: '' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect($('[data-testid="claimable-error-summary"] a').text().trim()).toBe(
      'Enter total area of eligible woodland'
    )
    expect(createEntitlement).not.toHaveBeenCalled()
  })

  test('explains a refusal from the backend without blaming the form', async () => {
    vi.mocked(createEntitlement).mockRejectedValue(
      Object.assign(new Error('Response Error'), {
        isBoom: true,
        output: { statusCode: 409 },
        data: {
          payload: {
            statusCode: 409,
            errorCode: 'ENTITLEMENT_LIMIT_EXCEEDED',
            message:
              "Cannot create entitlement 'ENT_CS_CAPITAL_PA3'. Maximum instance limit of 3 has been reached."
          }
        }
      })
    )

    const { result, statusCode } = await post({ totalHectares: '40.25' })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(409)
    expect(
      $('[data-testid="claimable-error-summary"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toContain(
      "This item cannot be added: Cannot create entitlement 'ENT_CS_CAPITAL_PA3'. Maximum instance limit of 3 has been reached. Please try again."
    )
    expect($('#totalHectares').attr('value')).toBe('40.25')
    expect($('.govuk-error-message')).toHaveLength(0)
  })

  test('refuses to create against a claim code at its maximum', async () => {
    givenClaims([template({ createdCount: 1, maxEntitlements: 1 })])

    const { statusCode } = await post({ totalHectares: '40.25' })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(createEntitlement).not.toHaveBeenCalled()
  })
})
