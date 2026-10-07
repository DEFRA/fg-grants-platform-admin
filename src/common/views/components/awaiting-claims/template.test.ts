import { render } from '#test/utils.ts'

const claim = (overrides = {}) => ({
  entitlementId: 'entitlement-1',
  claimCode: 'ENT_CS_CAPITAL_PA3',
  description: 'Entitlement for Woodland Management Plan (PA3).',
  amount: '455,000 ha',
  changeHref: '/claims/entitlements/entitlement-1/change',
  ...overrides
})

describe('awaiting claims component', () => {
  test('heads the section and explains it', () => {
    const $section = render('awaiting-claims', { awaitingClaims: [claim()] })

    expect(
      $section('[data-testid="awaiting-claims-heading"]').text().trim()
    ).toBe('Awaiting a claim')
    expect(
      $section('[data-testid="awaiting-claims-subtext"]').text().trim()
    ).toBe('The applicant has not made a claim against these items yet.')
  })

  test('lists each claimable entitlement', () => {
    const $section = render('awaiting-claims', {
      awaitingClaims: [
        claim(),
        claim({ claimCode: 'ENT_PA4', description: 'Entitlement PA4' })
      ]
    })

    expect(
      $section('[data-testid="awaiting-claims"] thead th')
        .map((_, header) => $section(header).text().trim())
        .get()
    ).toEqual(['Claimable item', 'Amount', 'Actions'])
    expect($section('[data-testid="awaiting-claim"]')).toHaveLength(2)
    expect(
      $section('[data-testid="awaiting-claim-description"]')
        .first()
        .text()
        .trim()
    ).toBe('Entitlement for Woodland Management Plan (PA3).')
    expect(
      $section('[data-testid="awaiting-claim-code"]').first().text().trim()
    ).toBe('ENT_CS_CAPITAL_PA3')
    expect(
      $section('[data-testid="awaiting-claim-amount"]').first().text().trim()
    ).toBe('455,000 ha')
  })

  test('links each item to its change page', () => {
    const $section = render('awaiting-claims', { awaitingClaims: [claim()] })
    const $change = $section('[data-testid="awaiting-claim-change"]')

    expect($change.attr('href')).toBe(
      '/claims/entitlements/entitlement-1/change'
    )
    expect($change.text().replace(/\s+/g, ' ').trim()).toBe(
      'Change Entitlement for Woodland Management Plan (PA3).'
    )
    expect($change.find('.govuk-visually-hidden').text().trim()).toBe(
      'Entitlement for Woodland Management Plan (PA3).'
    )
  })

  test('leaves the change link off an item that cannot be changed', () => {
    const $section = render('awaiting-claims', {
      awaitingClaims: [claim({ changeHref: undefined })]
    })

    expect($section('[data-testid="awaiting-claim-change"]')).toHaveLength(0)
  })

  test('withholds the change link from the item being changed', () => {
    const $section = render('awaiting-claims', {
      awaitingClaims: [
        claim(),
        claim({
          entitlementId: 'entitlement-2',
          changeHref: '/claims/entitlements/entitlement-2/change'
        })
      ],
      changingEntitlementId: 'entitlement-1'
    })

    const $links = $section('[data-testid="awaiting-claim-change"]')

    expect($section('[data-testid="awaiting-claim"]')).toHaveLength(2)
    expect($links).toHaveLength(1)
    expect($links.attr('href')).toBe(
      '/claims/entitlements/entitlement-2/change'
    )
  })

  test('shows an empty state when no items are claimable', () => {
    const $section = render('awaiting-claims', { awaitingClaims: [] })

    expect($section('[data-testid="awaiting-claims"]')).toHaveLength(0)
    expect($section('[data-testid="awaiting-claims-subtext"]')).toHaveLength(0)
    expect($section('[data-testid="no-awaiting-claims"]').text().trim()).toBe(
      'Nothing currently claimable'
    )
  })
})
