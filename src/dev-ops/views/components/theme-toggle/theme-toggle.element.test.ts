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

  test('clears the stored theme when the controller is unchecked', async () => {
    localStorage.setItem(storageKey, 'dark')

    const checkbox = await mountToggle()
    flip(checkbox!, false)

    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  test('upgrades without a controller to enhance', async () => {
    await mountToggle()
    document.body.innerHTML = '<do-theme-toggle></do-theme-toggle>'
    await Promise.resolve()

    expect(document.querySelector('do-theme-toggle')).toBeInstanceOf(
      ThemeToggle
    )
  })

  test('leaves the controller unchecked when storage reads throw', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const checkbox = await mountToggle()

    expect(checkbox?.checked).toBe(false)
  })

  test('still switches the theme when storage writes throw', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const checkbox = await mountToggle()
    flip(checkbox!, true)

    expect(checkbox?.checked).toBe(true)
  })
})
