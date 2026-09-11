// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { AuditSwitch } from './audit-switch.element.ts'

const off = {
  checked: false,
  href: '/dev-ops/events?audit=include',
  label: 'Show audit events',
  title: 'Show audit events alongside the queue'
}

const mountSwitch = async (overrides: object = {}) => {
  const body = await mount('audit-switch', { ...off, ...overrides })

  return {
    link: body.querySelector<HTMLAnchorElement>(
      '[data-testid="events-filter-audit-switch"]'
    )!,
    toggle: body.querySelector<HTMLElement>(
      '[data-testid="events-filter-audit-toggle"]'
    )!,
    state: body.querySelector<HTMLElement>(
      '[data-testid="events-filter-audit-state"]'
    )!
  }
}

/**
 * A click the test can inspect without navigating away: the element's own
 * listener runs first, then this one cancels the navigation happy-dom would
 * otherwise attempt — after the element has had its say, so a switch that
 * checked `defaultPrevented` still sees an ordinary click.
 */
const click = (link: HTMLAnchorElement, init: MouseEventInit = {}) => {
  let prevented = false
  const stop = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }

  link.addEventListener('click', stop, { once: true })
  link.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  )

  return { preventedBySwitch: prevented }
}

describe('do-audit-switch', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountSwitch()

    expect(customElements.get('do-audit-switch')).toBe(AuditSwitch)
  })

  // The knob turns the moment it is pressed, rather than when the next page
  // arrives — and the hidden state in the link's name turns with it.
  test('flips the switch on an ordinary click', async () => {
    const { link, toggle, state } = await mountSwitch()

    click(link)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(state.textContent).toBe(', on')
  })

  test('flips an on switch off', async () => {
    const { link, toggle, state } = await mountSwitch({
      checked: true,
      href: '/dev-ops/events'
    })

    click(link)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  // The link does the navigating: the element neither cancels it nor holds
  // it up.
  test('leaves the navigation to the link', async () => {
    const { link } = await mountSwitch()

    expect(click(link).preventedBySwitch).toBe(false)
    expect(link.getAttribute('href')).toBe('/dev-ops/events?audit=include')
  })

  // A modified or middle click opens the url somewhere else and leaves this
  // page as it is, so this page's switch must not move.
  test.each([
    ['a ctrl click', { ctrlKey: true }],
    ['a cmd click', { metaKey: true }],
    ['a shift click', { shiftKey: true }],
    ['an alt click', { altKey: true }],
    ['a middle click', { button: 1 }]
  ])('ignores %s', async (_name, init) => {
    const { link, toggle, state } = await mountSwitch()

    click(link, init)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  // The element enhances what the markup already does, so a host without
  // the parts it expects is left exactly as it was found.
  test('leaves markup it does not recognise alone', async () => {
    document.body.innerHTML =
      '<do-audit-switch data-checked="false"><a href="/x">Nothing here</a></do-audit-switch>'

    await Promise.resolve()

    document
      .querySelector('a')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )

    expect(document.querySelector('a')!.textContent).toBe('Nothing here')
  })
})

// A page restored from the bfcache comes back as the operator left it —
// including the flip on the way out — while its url and its link's href are
// still about the state it was rendered in.
describe('do-audit-switch after a back-navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  // happy-dom constructs a `PageTransitionEvent` but drops its `persisted`
  // flag, which is the whole signal here, so the flag is set on the event
  // itself - the shape a browser delivers.
  const pageshow = (persisted: boolean) => {
    const event = new Event('pageshow')

    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }

  test('puts a flipped switch back to the state it was rendered in', async () => {
    const { link, toggle, state } = await mountSwitch()

    click(link)
    pageshow(true)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  test('restores an on page to on, not to the default', async () => {
    const { link, toggle } = await mountSwitch({
      checked: true,
      href: '/dev-ops/events'
    })

    click(link)
    pageshow(true)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  // An ordinary forward navigation is a fresh render: nothing to put back.
  test('leaves a page that was not restored alone', async () => {
    const { link, toggle } = await mountSwitch()

    click(link)
    pageshow(false)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
