import { toHomePage } from './home-page.view-model.ts'

describe('toHomePage', () => {
  test('heads the page Manage grants and names the operator', () => {
    expect(toHomePage({ grantTypeCount: 4 }, 'Ada Lovelace')).toMatchObject({
      pageTitle: 'Manage grants',
      heading: 'Manage grants',
      name: 'Ada Lovelace'
    })
  })

  test('links the Grant types card to the Grant Types page, with the count', () => {
    const [grantTypes] = toHomePage({ grantTypeCount: 4 }, 'Ada').cards

    expect(grantTypes).toEqual({
      id: 'grant-types',
      title: 'Grant types',
      href: '/grant-ops/grants',
      description: 'Browse the 4 grant schemes and manage scheme parameters'
    })
  })

  test('shows a count of none', () => {
    const [grantTypes] = toHomePage({ grantTypeCount: 0 }, 'Ada').cards

    expect(grantTypes.description).toBe(
      'Browse the 0 grant schemes and manage scheme parameters'
    )
  })

  test('leaves the number out when there is no count', () => {
    const [grantTypes] = toHomePage({ grantTypeCount: null }, 'Ada').cards

    expect(grantTypes.description).toBe(
      'Browse the grant schemes and manage scheme parameters'
    )
  })

  test('gives the Grant applications card a placeholder link and no description', () => {
    const [, grantApplications] = toHomePage({ grantTypeCount: 4 }, 'Ada').cards

    expect(grantApplications).toEqual({
      id: 'grant-applications',
      title: 'Grant applications',
      href: '#'
    })
  })
})
