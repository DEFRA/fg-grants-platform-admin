import { render } from '#test/utils.ts'

const claim = (overrides = {}) => ({
  name: 'PA3 Woodland Management Plan entitlement',
  clientClaimRef: 'WMP-TU3-LBJ-C07',
  quantity: '23 ha',
  value: '£1,500',
  requiresApproval: 'No',
  approvalStatus: '',
  paymentStatus: 'Payment scheduled',
  ...overrides
})

const cells = ($section: ReturnType<typeof render>, testId: string) =>
  $section(`[data-testid="${testId}"]`)
    .map((_, cell) => $section(cell).text().trim())
    .get()

describe('claimed claims component', () => {
  test('heads the section', () => {
    const $section = render('claimed-claims', { claimed: [claim()] })

    expect(
      $section('[data-testid="claimed-claims-heading"]').text().trim()
    ).toBe('Claimed')
  })

  test('names the columns the caseworker reads', () => {
    const $section = render('claimed-claims', { claimed: [claim()] })

    expect(
      $section('[data-testid="claimed-claims"] thead th')
        .map((_, header) => $section(header).text().trim())
        .get()
    ).toEqual([
      'Claim type',
      'Quantity',
      'Claim value',
      'Requires approval',
      'Approval status',
      'Payment status'
    ])
  })

  test('shows the claim reference beneath its type', () => {
    const $section = render('claimed-claims', { claimed: [claim()] })

    expect(cells($section, 'claimed-claim-name')).toEqual([
      'PA3 Woodland Management Plan entitlement'
    ])
    expect(cells($section, 'claimed-claim-reference')).toEqual([
      'WMP-TU3-LBJ-C07'
    ])
  })

  test('shows the quantity, value and statuses', () => {
    const $section = render('claimed-claims', { claimed: [claim()] })

    expect(cells($section, 'claimed-claim-quantity')).toEqual(['23 ha'])
    expect(cells($section, 'claimed-claim-value')).toEqual(['£1,500'])
    expect(cells($section, 'claimed-claim-requires-approval')).toEqual(['No'])
    expect(cells($section, 'claimed-claim-approval-status')).toEqual([''])
    expect(cells($section, 'claimed-claim-payment-status')).toEqual([
      'Payment scheduled'
    ])
  })

  test('lists every submitted claim', () => {
    const $section = render('claimed-claims', {
      claimed: [
        claim(),
        claim({
          clientClaimRef: 'WMP-TU3-LBJ-C08',
          requiresApproval: 'Yes',
          paymentStatus: ''
        })
      ]
    })

    expect($section('[data-testid="claimed-claim"]')).toHaveLength(2)
    expect(cells($section, 'claimed-claim-requires-approval')).toEqual([
      'No',
      'Yes'
    ])
    expect(cells($section, 'claimed-claim-payment-status')).toEqual([
      'Payment scheduled',
      ''
    ])
  })

  test('shows an empty state when nothing has been claimed', () => {
    const $section = render('claimed-claims', { claimed: [] })

    expect($section('[data-testid="claimed-claims"]')).toHaveLength(0)
    expect(
      $section('[data-testid="claimed-claims-heading"]').text().trim()
    ).toBe('Claimed')
    expect($section('[data-testid="no-claimed-claims"]').text().trim()).toBe(
      'No items claimed'
    )
  })
})
