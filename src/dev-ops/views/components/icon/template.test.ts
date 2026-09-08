import { render } from '../../../test-utils.ts'

describe('icon component', () => {
  test('renders the named heroicon as an inline svg', () => {
    const $icon = render('icon', { name: 'moon', class: 'h-5 w-5' })

    const svg = $icon('[data-testid="do-icon-moon"]')

    expect(svg).toHaveLength(1)
    expect(svg.attr('class')).toBe('h-5 w-5')
    expect(svg.attr('aria-hidden')).toBe('true')
    expect(svg.attr('fill')).toBe('currentColor')
    expect(svg.find('path')).toHaveLength(1)
  })

  test('escapes hostile classes rather than emitting them', () => {
    const $icon = render('icon', { name: 'moon', class: '"><script>' })

    expect($icon('script')).toHaveLength(0)
  })

  test('omits the class attribute when no classes are given', () => {
    const $icon = render('icon', { name: 'sun' })

    expect($icon('[data-testid="do-icon-sun"]').attr('class')).toBeUndefined()
  })

  test('throws for a name the set does not hold', () => {
    expect(() => render('icon', { name: 'unicorn' })).toThrow(
      'template not found'
    )
  })
})
