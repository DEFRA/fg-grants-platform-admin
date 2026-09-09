// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { ThemeToggle } from './theme-toggle.element.ts'

const storageKey = 'dev-ops-theme'

const mountToggle = async () => {
  const body = await mount('theme-toggle', {})
  return body.querySelector('input')
}

const flip = (checkbox: HTMLInputElement, checked: boolean) => {
  checkbox.checked = checked
  checkbox.dispatchEvent(new Event('change'))
}

describe('do-theme-toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountToggle()

    expect(customElements.get('do-theme-toggle')).toBe(ThemeToggle)
  })

  test('leaves the controller unchecked when no theme is stored', async () => {
    const checkbox = await mountToggle()

    expect(checkbox?.checked).toBe(false)
  })

  test('restores a stored theme by checking the controller', async () => {
    localStorage.setItem(storageKey, 'dark')

    const checkbox = await mountToggle()

    expect(checkbox?.checked).toBe(true)
  })

  test('ignores a stored theme the controller does not offer', async () => {
    localStorage.setItem(storageKey, 'synthwave')

    const checkbox = await mountToggle()

    expect(checkbox?.checked).toBe(false)
  })

  test('persists the theme when the controller is checked', async () => {
    const checkbox = await mountToggle()

    flip(checkbox!, true)

    expect(localStorage.getItem(storageKey)).toBe('dark')
  })

  // Light is a choice now, not the absence of one. It has to be: on a machine
  // whose OS asks for dark, "no stored theme" MEANS dark, so storing nothing
  // was how unchecking the box failed to reach light at all.
  test('stores light when the controller is unchecked', async () => {
    localStorage.setItem(storageKey, 'dark')

    const checkbox = await mountToggle()
    flip(checkbox!, false)

    expect(localStorage.getItem(storageKey)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  // The generated stylesheet applies the OS preference through
  // `:root:not([data-theme])`, so stating the theme on the root is what takes
  // the page out of the OS's hands - and what the control then reports.
  test('states the theme on the root rather than leaving it to the OS', async () => {
    localStorage.setItem(storageKey, 'dark')

    const checkbox = await mountToggle()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(checkbox?.checked).toBe(true)
  })

  test('upgrades without a controller to enhance', async () => {
    await mountToggle()
    document.body.innerHTML = '<do-theme-toggle></do-theme-toggle>'
    await Promise.resolve()

    expect(document.querySelector('do-theme-toggle')).toBeInstanceOf(
      ThemeToggle
    )
  })

  // Storage can be refused outright (a private window, blocked site data).
  // The control still has to report the theme the page is actually in, which
  // with nothing readable is the one the OS asked for.
  test('falls back to the OS preference when storage reads throw', async () => {
    // Once, not for the rest of the file: happy-dom's storage is a proxy, and
    // a spy installed on it outlives `restoreAllMocks`, which would turn
    // every later "nothing stored" case into "storage is broken".
    vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () => ({ matches: false }) as MediaQueryList
    )

    const checkbox = await mountToggle()

    expect(checkbox?.checked).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('still switches the theme when storage writes throw', async () => {
    // Once, for the same reason the read spy above is: a spy on happy-dom's
    // proxied storage outlives `restoreAllMocks`, and would silently break
    // every later test that expects a write to land.
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })

    const checkbox = await mountToggle()
    flip(checkbox!, true)

    expect(checkbox?.checked).toBe(true)
  })
})

// With nothing stored, the theme is whatever the OS asks for - and the
// control has to report THAT, which is precisely what it did not do: a
// dark-OS operator saw a dark page with the toggle in its light position.
describe('do-theme-toggle with nothing stored', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    delete document.documentElement.dataset.theme
  })

  const givenOsPrefers = (theme: string) => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('dark') && theme === 'dark'
        }) as MediaQueryList
    )
  }

  // The bug this exists to kill: a dark-OS operator saw a dark page with the
  // toggle sitting in its light position, and checking it changed nothing.
  test('agrees with a dark OS, and says so on the control', async () => {
    givenOsPrefers('dark')

    const checkbox = await mountToggle()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(checkbox?.checked).toBe(true)
  })

  test('agrees with a light OS', async () => {
    givenOsPrefers('light')

    const checkbox = await mountToggle()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(checkbox?.checked).toBe(false)
  })

  // And from there the toggle can actually reach the other one, which is
  // what it could not do before.
  test('reaches light from a dark OS', async () => {
    givenOsPrefers('dark')

    const checkbox = await mountToggle()
    flip(checkbox!, false)

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(storageKey)).toBe('light')
  })
})
