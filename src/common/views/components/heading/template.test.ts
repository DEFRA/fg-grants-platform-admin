import { render } from '#test/utils.ts'

describe('heading component', () => {
  test('renders the heading with its title and caption', () => {
    const $heading = render('heading', {
      text: 'Services',
      caption: 'A page showing available services'
    })

    expect($heading('[data-testid="app-heading"]')).toHaveLength(1)
    expect($heading('[data-testid="app-heading-title"]').text().trim()).toBe(
      'Services'
    )
    expect($heading('[data-testid="app-heading-caption"]').text().trim()).toBe(
      'A page showing available services'
    )
  })
})
