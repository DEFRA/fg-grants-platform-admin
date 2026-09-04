import { render } from '../../../test-utils.ts'

const params = { value: 'GLD-9B2-BWS-grasslands', what: 'reference' }

describe('copy-button component', () => {
  test('renders a tiny ghost button holding the value it copies', () => {
    const $button = render('copy-button', params)

    const control = $button('[data-testid="do-copy-button-control"]')

    expect($button('do-copy-button').attr('value')).toBe(
      'GLD-9B2-BWS-grasslands'
    )
    expect(control.attr('type')).toBe('button')
    expect(control.attr('class')).toBe('btn btn-ghost btn-xs btn-square')
  })

  // The icon says nothing on its own, so the tooltip says it: stock daisyUI,
  // and the same noun the accessible name carries.
  test('names what it copies in a tooltip too', () => {
    const $button = render('copy-button', params)

    const tooltip = $button('.tooltip')

    expect(tooltip.attr('data-tip')).toBe('Copy reference')
    expect(tooltip.find('[data-testid="do-copy-button-control"]')).toHaveLength(
      1
    )
  })

  // "Copy", said forty times down a page, names nothing for a screen reader
  // walking the row: the label carries the noun.
  test('names what it copies, for assistive technology', () => {
    expect(
      render('copy-button', { value: 'x', what: 'event id' })(
        '[data-testid="do-copy-button-control"]'
      ).attr('aria-label')
    ).toBe('Copy event id')
  })

  // A button that looks live and does nothing when clicked is worse than no
  // button: the element enables it, and only where there is a clipboard.
  test('ships disabled, for the element to enable', () => {
    const $button = render('copy-button', params)

    expect(
      $button('[data-testid="do-copy-button-control"]').is('[disabled]')
    ).toBe(true)
  })

  // Both glyphs are in the markup because daisyUI's swap shows one of them: a
  // swap done by rewriting the button's markup would throw the row's layout
  // for a frame.
  test('holds both glyphs in a swap, for the element to flip', () => {
    const $button = render('copy-button', params)

    const swap = $button('[data-testid="do-copy-button-swap"]')

    expect(swap.attr('class')).toBe('swap')
    expect(swap.attr('class')).not.toContain('swap-active')
    expect($button('[data-testid="do-icon-copy"]').attr('class')).toBe(
      'swap-off size-3.5 opacity-60'
    )
    expect($button('[data-testid="do-icon-check"]').attr('class')).toBe(
      'swap-on size-3.5 text-success'
    )
  })

  // The list has none of these — every id there is one click from the page
  // that draws it whole — so the handful that are left sit beside values
  // somebody came to the page to carry, and are drawn at all times.
  test('is drawn at all times, not on hover', () => {
    const $button = render('copy-button', params)

    expect(
      $button('[data-testid="do-copy-button-control"]').attr('class')
    ).not.toContain('opacity-0')
  })

  test('escapes a hostile value rather than emitting it', () => {
    const $button = render('copy-button', {
      value: '"><script>alert(1)</script>',
      what: 'event id'
    })

    expect($button('script')).toHaveLength(0)
    expect($button('do-copy-button').attr('value')).toBe(
      '"><script>alert(1)</script>'
    )
  })
})
