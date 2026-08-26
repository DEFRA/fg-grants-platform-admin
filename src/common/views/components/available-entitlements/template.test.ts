import { render } from '#test/utils.ts'

const row = (overrides = {}) => ({
  claimCode: 'ENT_CS_CAPITAL_PA3',
  name: 'PA3 Woodland Management Plan entitlement',
  type: 'Hectares',
  createdCount: 0,
  maxEntitlements: 1,
  canCreate: true,
  createHref: '/grant-ops/grants/woodland/applications/wood-1001/claims',
  ...overrides
})

describe('available entitlements component', () => {
  test('heads the section', () => {
    const $section = render('available-entitlements', { entitlements: [row()] })

    expect(
      $section('[data-testid="available-entitlements-heading"]').text().trim()
    ).toBe('Claimable items')
  })

  test('lists a row for each entitlement it was given', () => {
    const $section = render('available-entitlements', {
      entitlements: [row(), row({ claimCode: 'ENT_PA4', name: 'PA4' })]
    })

    expect(
      $section('[data-testid="available-entitlements"] thead th')
        .map((_, header) => $section(header).text().trim())
        .get()
    ).toEqual(['Claimable item', 'Type', 'Created', 'Action'])
    expect($section('[data-testid="available-entitlement"]')).toHaveLength(2)
  })

  test('names the item and its type as plain text', () => {
    const $section = render('available-entitlements', { entitlements: [row()] })

    expect(
      $section('[data-testid="available-entitlement-name"]').text().trim()
    ).toBe('PA3 Woodland Management Plan entitlement')
    expect(
      $section('[data-testid="available-entitlement-type"]').text().trim()
    ).toBe('Hectares')
    expect($section('.govuk-tag')).toHaveLength(0)
  })

  test('counts what has been created against the maximum', () => {
    const $section = render('available-entitlements', {
      entitlements: [row({ createdCount: 1, maxEntitlements: 3 })]
    })

    expect(
      $section('[data-testid="available-entitlement-created"]').text().trim()
    ).toBe('1 of 3')
  })

  test('links to the page that creates the entitlement', () => {
    const $section = render('available-entitlements', {
      entitlements: [row({ createHref: '/create-pa3#new-entitlement' })]
    })

    expect(
      $section('[data-testid="available-entitlement-create"]').attr('href')
    ).toBe('/create-pa3#new-entitlement')
  })

  test('replaces the link with a reason once the maximum is reached', () => {
    const $section = render('available-entitlements', {
      entitlements: [
        row({
          canCreate: false,
          createHref: undefined,
          unavailableReason: 'Maximum reached'
        })
      ]
    })

    expect(
      $section('[data-testid="available-entitlement-create"]')
    ).toHaveLength(0)
    expect(
      $section('[data-testid="available-entitlement-unavailable"]')
        .text()
        .trim()
    ).toBe('Maximum reached')
  })

  test('withholds the create link from the entitlement being created', () => {
    const $section = render('available-entitlements', {
      entitlements: [
        row(),
        row({
          claimCode: 'ENT_PA4',
          name: 'PA4',
          createHref: '/create-pa4#new-entitlement'
        })
      ],
      creatingClaimCode: 'ENT_CS_CAPITAL_PA3'
    })

    expect($section('[data-testid="available-entitlement"]')).toHaveLength(2)

    const $links = $section('[data-testid="available-entitlement-create"]')

    expect($links).toHaveLength(1)
    expect($links.attr('href')).toBe('/create-pa4#new-entitlement')
  })

  test('says so when nothing is available', () => {
    const $section = render('available-entitlements', { entitlements: [] })

    expect($section('[data-testid="available-entitlements"]')).toHaveLength(0)
    expect(
      $section('[data-testid="no-available-entitlements"]').text().trim()
    ).toBe('No claimable items are available for this application.')
  })
})
