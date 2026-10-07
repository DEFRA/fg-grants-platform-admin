import { render } from '../../../test-utils.ts'

const user = {
  name: 'Ada Lovelace',
  email: 'ada@example.gov.uk',
  initials: 'AL'
}

const menu = (params: object) =>
  render('user-menu', { signOutHref: '/auth/logout', ...params })

describe('user-menu component', () => {
  test('opens a popover from a button named for the account', () => {
    const $ = menu({ user })
    const button = $('[data-testid="do-user-button"]')
    const panel = $('[data-testid="do-user-panel"]')

    expect(button.attr('type')).toBe('button')
    expect(button.attr('popovertarget')).toBe(panel.attr('id'))
    expect(button.attr('aria-label')).toBe('Account: Ada Lovelace')
    expect(panel.is('[popover]')).toBe(true)
    expect(panel.hasClass('dropdown-top')).toBe(true)
    expect(panel.hasClass('w-56')).toBe(true)
  })

  test('shows the initials, the name and the email, then Sign out', () => {
    const $ = menu({ user })

    expect($('.avatar').text().trim()).toBe('AL')
    expect($('.avatar').attr('aria-hidden')).toBe('true')
    expect($('[data-testid="do-user-name"]').text()).toBe('Ada Lovelace')
    expect($('[data-testid="do-user-email"]').text()).toBe('ada@example.gov.uk')
    expect($('[data-testid="do-sign-out"]').attr('href')).toBe('/auth/logout')
    expect(
      $('[data-testid="do-sign-out"] [data-testid="do-icon-log-out"]')
    ).toHaveLength(1)
  })

  test('leaves the email out when it is the name already', () => {
    const $ = menu({
      user: {
        name: 'ada@example.gov.uk',
        email: 'ada@example.gov.uk',
        initials: 'A'
      }
    })

    expect($('[data-testid="do-user-email"]')).toHaveLength(0)
  })

  test('escapes a name containing markup', () => {
    const $ = menu({
      user: { name: '<script>alert(1)</script>', email: '', initials: '<' }
    })

    expect($('script')).toHaveLength(0)
  })
})
