import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { grantOps } from '../index.ts'
import type { EntitlementTemplate } from '../use-cases/get-claims.use-case.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'

vi.mock(import('../use-cases/get-claims.use-case.ts'))

const claimsUrl = '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims'
const url = `${claimsUrl}/entitlements/ENT_CS_CAPITAL_PA3`

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

describe('newClaimableItemRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([grantOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenClaims([template()])
  })

  afterAll(async () => {
    await server.stop()
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
      `${claimsUrl}/entitlements/ENT_CS_CAPITAL_PA4#new-entitlement`
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
