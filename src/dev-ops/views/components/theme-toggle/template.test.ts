import { render } from '../../../test-utils.ts'

describe('theme-toggle component', () => {
  test('wraps a dark theme-controller in its enhancement element', () => {
    const $toggle = render('theme-toggle', {})

    const checkbox = $toggle('do-theme-toggle input.theme-controller')

    expect(checkbox).toHaveLength(1)
    expect(checkbox.attr('value')).toBe('dark')
    expect(checkbox.attr('type')).toBe('checkbox')
  })

  test('labels the checkbox itself for assistive technology', () => {
    const $toggle = render('theme-toggle', {})

    expect($toggle('input.theme-controller').attr('aria-label')).toBe(
      'Dark theme'
    )
    expect($toggle('svg[aria-hidden="true"]')).toHaveLength(2)
  })

  test('checks the controller when dark is rendered server-side', () => {
    const $toggle = render('theme-toggle', { theme: 'dark' })

    expect($toggle('input.theme-controller').attr('checked')).toBe('checked')
  })
})
