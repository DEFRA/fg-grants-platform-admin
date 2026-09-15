import { render } from '../../../test-utils.ts'

const off = {
  checked: false,
  href: '/dev-ops/events?status=DEAD_LETTER&audit=include',
  label: 'Show audit events',
  title: 'Show audit events alongside the queue'
}

const on = {
  ...off,
  checked: true,
  href: '/dev-ops/events?status=DEAD_LETTER',
  title: 'Hide audit events: the queue alone'
}

describe('audit-switch component', () => {
  test('is one link to the url it was given', () => {
    const $switch = render('audit-switch', off)

    const link = $switch('[data-testid="events-filter-audit-switch"]')

    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(off.href)
    expect(link.attr('title')).toBe(off.title)
  })

  test('draws the switch as a hidden span, not an input', () => {
    const $switch = render('audit-switch', off)

    const toggle = $switch('[data-testid="events-filter-audit-toggle"]')

    expect(toggle.is('span')).toBe(true)
    expect(toggle.attr('class')).toBe('toggle')
    expect(toggle.attr('aria-hidden')).toBe('true')
    expect($switch('input, button')).toHaveLength(0)
  })

  test('names the link with its state, off', () => {
    const $switch = render('audit-switch', off)

    expect(
      $switch('[data-testid="events-filter-audit-switch"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toBe('Show audit events, off')
    expect(
      $switch('[data-testid="events-filter-audit-toggle"]').attr('aria-checked')
    ).toBe('false')
    expect(
      $switch('[data-testid="events-filter-audit-state"]').attr('class')
    ).toBe('sr-only')
  })

  test('names the link with its state, on', () => {
    const $switch = render('audit-switch', on)

    expect($switch('[data-testid="events-filter-audit-state"]').text()).toBe(
      ', on'
    )
    expect(
      $switch('[data-testid="events-filter-audit-toggle"]').attr('aria-checked')
    ).toBe('true')
  })

  // `data-checked` is the rendered state, for restoring after a bfcache return.
  test('keeps the rendered state on the element', () => {
    expect(
      render('audit-switch', off)('do-audit-switch').attr('data-checked')
    ).toBe('false')
    expect(
      render('audit-switch', on)('do-audit-switch').attr('data-checked')
    ).toBe('true')
  })

  test("is a plain link at a md trigger's height, with the triggers' focus ring", () => {
    const link = render(
      'audit-switch',
      off
    )('[data-testid="events-filter-audit-switch"]')

    expect(link.hasClass('btn')).toBe(false)
    expect(link.hasClass('h-10')).toBe(true)
    expect(link.hasClass('cursor-pointer')).toBe(true)
    expect(link.hasClass('focus-visible:outline-2')).toBe(true)
    expect(link.hasClass('focus-visible:outline-offset-2')).toBe(true)
  })

  test('escapes hostile params rather than emitting them', () => {
    const $switch = render('audit-switch', {
      ...off,
      href: '"><script>alert(1)</script>',
      title: '"><script>alert(1)</script>'
    })

    expect($switch('script')).toHaveLength(0)
  })
})
