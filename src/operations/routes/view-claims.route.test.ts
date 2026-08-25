import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { operations } from '../index.ts'
import type { EntitlementTemplate } from '../use-cases/get-claims.use-case.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'

vi.mock(import('../use-cases/get-claims.use-case.ts'))

const url = '/grant-ops/grants/woodland/applications/WMP-1T9-RXN/claims'

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
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
    scheme: {
      label: 'Scheme',
      text: 'Woodland Management Plan',
      type: 'string'
    },
    applicationId: {
      label: 'Application ID',
      text: 'WMP-1T9-RXN',
      type: 'string'
    },
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

describe('viewClaimsRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([operations])
    await server.initialize()
  })

  beforeEach(() => {
    givenClaims()
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
    await viewPage()

    expect(getClaimsUseCase).toHaveBeenCalledWith('woodland', 'WMP-1T9-RXN')
  })

  // The header is whatever the grant configured, resolved by the backend.
  test('heads the page with the banner the backend resolved', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="application-header-title"]').text().trim()).toBe(
      'Elmwood Land Co'
    )
    expect(
      $('[data-testid="application-header-field"]')
        .map((_, field) => $(field).text().replace(/\s+/g, ' ').trim())
        .get()
    ).toEqual([
      'Scheme Woodland Management Plan',
      'Application ID WMP-1T9-RXN',
      'SBI 113598882'
    ])
  })

  // A page headed by nothing tells a case officer less than an honest 404 does.
  // The backend answers 404 for such a grant; this guards an older one that
  // does not yet.
  test('refuses the page when a grant configures no header', async () => {
    vi.mocked(getClaimsUseCase).mockResolvedValue({
      availableEntitlements: [],
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

  // The tab bar is the govuk service navigation component, the same one the
  // case working frontend moves between a case's sections with.
  test('offers a tab for each section of the application', async () => {
    const { $ } = await viewPage()

    expect(
      $('.app-application-tabs .govuk-service-navigation__item')
        .map((_, item) => $(item).text().trim())
        .get()
    ).toEqual(['Application data', 'Claims', 'Payments'])
  })

  test('shows the claims tab as the current one', async () => {
    const { $ } = await viewPage()

    const $current = $(
      '.app-application-tabs .govuk-service-navigation__item--active'
    )

    expect($current).toHaveLength(1)
    expect($current.text().trim()).toBe('Claims')

    const $link = $current.find('.govuk-service-navigation__link')

    expect($link.attr('href')).toBe(url)
    expect($link.attr('aria-current')).toBe('page')
  })

  test('introduces the available entitlements section', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="available-entitlements-heading"]').text().trim()
    ).toBe('Available entitlements')
    expect($('[data-testid="available-entitlements-hint"]').text().trim()).toBe(
      'Entitlements you can create for this applicant. Some can be created more than once.'
    )
    expect(
      $('[data-testid="available-entitlements-explanation"]').text().trim()
    ).not.toBe('')
  })

  test('lists an available entitlement in the table', async () => {
    givenClaims([template()])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="available-entitlements"] thead th')
        .map((_, header) => $(header).text().trim())
        .get()
    ).toEqual(['Entitlement', 'Type', 'Created', 'Action'])

    expect($('[data-testid="available-entitlement"]')).toHaveLength(1)
    expect($('[data-testid="available-entitlement-name"]').text().trim()).toBe(
      'PA3 Woodland Management Plan entitlement'
    )
    expect(
      $('[data-testid="available-entitlement-description"]').text().trim()
    ).toBe('The maximum eligible woodland area that can be claimed.')
    expect(
      $('[data-testid="available-entitlement-type"] .govuk-tag').text().trim()
    ).toBe('Hectares')
    expect(
      $('[data-testid="available-entitlement-created"]').text().trim()
    ).toBe('0 of 1')
    expect($('[data-testid="available-entitlement-create"]')).toHaveLength(1)
    expect($('[data-testid="available-entitlement-create"]').attr('href')).toBe(
      `${url}/entitlements/ENT_CS_CAPITAL_PA3#new-entitlement`
    )
  })

  // Rendered as spans first time round, which ran the description on from the
  // name as one paragraph of text.
  test('sets the name and description on their own lines', async () => {
    givenClaims([template()])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="available-entitlement-name"]').prop('tagName')
    ).toBe('P')
    expect(
      $('[data-testid="available-entitlement-description"]').prop('tagName')
    ).toBe('P')
  })

  test('lists a row for every available entitlement', async () => {
    givenClaims([
      template(),
      template({ claimCode: 'ENT_CS_CAPITAL_PA4', name: 'PA4 entitlement' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="available-entitlement"]')).toHaveLength(2)
  })

  test('counts what has been created against the maximum', async () => {
    givenClaims([template({ createdCount: 1, maxEntitlements: 3 })])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="available-entitlement-created"]').text().trim()
    ).toBe('1 of 3')
    expect($('[data-testid="available-entitlement-create"]')).toHaveLength(1)
  })

  test('replaces the create link with a reason once the maximum is reached', async () => {
    givenClaims([template({ createdCount: 1, maxEntitlements: 1 })])

    const { $ } = await viewPage()

    expect($('[data-testid="available-entitlement-create"]')).toHaveLength(0)
    expect(
      $('[data-testid="available-entitlement-unavailable"]').text().trim()
    ).toBe('Maximum reached')
  })

  test('leaves the type blank when no field carries a unit', async () => {
    givenClaims([
      template({
        fields: {
          reference: { input: true, label: 'Reference', unitType: 'string' }
        }
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="available-entitlement-type"]').text().trim()).toBe(
      ''
    )
  })

  test('titles the page Claims', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toEqual(expect.stringContaining('Claims |'))
  })

  test('tells the user when nothing is available', async () => {
    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="no-available-entitlements"]').text().trim()).toBe(
      'No entitlements are available for this application.'
    )
    expect($('[data-testid="available-entitlements"]')).toHaveLength(0)
  })
})
