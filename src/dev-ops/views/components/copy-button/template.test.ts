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
    expect(control.attr('class')).toContain('btn btn-ghost btn-xs')
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

  // Both glyphs are in the markup because CSS swaps them: a swap done by
  // rewriting the button's markup would throw the row's layout for a frame.
  test('holds both glyphs, for the stylesheet to swap', () => {
    const $button = render('copy-button', params)

    expect($button('[data-testid="do-icon-clipboard"]').attr('class')).toBe(
      'do-copy-idle h-3 w-3'
    )
    expect($button('[data-testid="do-icon-check"]').attr('class')).toBe(
      'do-copy-done h-3 w-3'
    )
  })

  // Forty icons drawn at all times would make the page about its buttons.
  test('stays invisible until its row is hovered or it is focused', () => {
    const $button = render('copy-button', params)

    expect(
      $button('[data-testid="do-copy-button-control"]').attr('class')
    ).toContain('opacity-0 group-hover:opacity-100 focus-visible:opacity-100')
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
