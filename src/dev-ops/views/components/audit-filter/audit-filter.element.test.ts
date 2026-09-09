// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { AuditFilter } from './audit-filter.element.ts'

const filter = {
  label: 'Exclude audit',
  excluded: true,
  includes: true,
  filters: [{ name: 'status', value: 'DEAD_LETTER' }],
  title: 'Audit records are hidden. Show them alongside the queue.'
}

const mountControl = async (overrides: object = {}) => {
  const body = await mount('audit-filter', {
    filter: { ...filter, ...overrides }
  })

  return {
    checkbox: body.querySelector<HTMLInputElement>(
      '[data-testid="events-filter-audit"]'
    )!,
    apply: body.querySelector<HTMLButtonElement>(
      '[data-testid="events-filter-audit-apply"]'
    )!,
    form: body.querySelector<HTMLFormElement>(
      '[data-testid="events-audit-form"]'
    )!
  }
}

/** A flip of the box, exactly as a click or a space bar makes one. */
const flip = (checkbox: HTMLInputElement) => {
  checkbox.checked = !checkbox.checked
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('do-audit-filter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountControl()

    expect(customElements.get('do-audit-filter')).toBe(AuditFilter)
  })

  // With script, the tick IS the apply — so the button that stood in for it
  // has no job left and is taken out of the row.
  test('hides the apply button once it has upgraded', async () => {
    const { apply } = await mountControl()

    expect(apply.hidden).toBe(true)
  })

  test('submits the form when the box is flipped', async () => {
    const { checkbox, form } = await mountControl()

    const submitted = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', submitted)

    flip(checkbox)

    expect(submitted).toHaveBeenCalledTimes(1)
  })

  // Through the button, not around it: the button carries the `audit` value,
  // and a submission that left it behind would ask for the page the operator
  // is already on.
  test('submits through the button that carries the parameter', async () => {
    const { checkbox, apply, form } = await mountControl()

    const submitter = vi.fn()
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitter((event as SubmitEvent).submitter)
    })

    flip(checkbox)

    expect(submitter).toHaveBeenCalledWith(apply)
  })

  test('submits nothing until the box is flipped', async () => {
    const { form } = await mountControl()

    const submitted = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', submitted)

    expect(submitted).not.toHaveBeenCalled()
  })

  // The element enhances what the markup already does, so a host with neither
  // half of the control is left exactly as it was found.
  test('leaves markup it does not recognise alone', async () => {
    document.body.innerHTML =
      '<do-audit-filter><p>Nothing here</p></do-audit-filter>'

    await Promise.resolve()

    expect(document.body.querySelector('p')?.hidden).toBe(false)
  })
})

// Restoring a page from the bfcache hands back a DOM the operator changed
// on the way out, while the button still carries the value the server
// rendered - so the control could submit the opposite of what it showed.
describe('do-audit-filter after a back-navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  // The button carries the value for the state the page was RENDERED in, and
  // the back button can hand back a page whose checkbox no longer matches it:
  // untick, navigate, come back, and the box is unticked while the button
  // still says `audit=include`. Ticking it then submitted the value for
  // unticking — the control doing the opposite of what it showed.
  // happy-dom constructs a `PageTransitionEvent` but drops its `persisted`
  // flag, which is the whole signal here, so the flag is set on the event
  // itself - the shape a browser delivers.
  const pageshow = (persisted: boolean) => {
    const event = new Event('pageshow')

    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }

  const restore = () => pageshow(true)

  test('puts the box back to the state the button is talking about', async () => {
    const { checkbox } = await mountControl()

    expect(checkbox.checked).toBe(true)

    checkbox.checked = false
    restore()

    expect(checkbox.checked).toBe(true)
  })

  test('restores an unticked page to unticked, not to the default', async () => {
    const { checkbox } = await mountControl({ excluded: false })

    expect(checkbox.checked).toBe(false)

    checkbox.checked = true
    restore()

    expect(checkbox.checked).toBe(false)
  })

  // An ordinary forward navigation is a fresh render: nothing to put back.
  test('leaves a page that was not restored alone', async () => {
    const { checkbox } = await mountControl()

    checkbox.checked = false
    pageshow(false)

    expect(checkbox.checked).toBe(false)
  })
})
