import { toGrantTypesPage } from './grant-types-page.view-model.ts'

describe('toGrantTypesPage', () => {
  test('titles the page Grant Types', () => {
    expect(toGrantTypesPage([])).toMatchObject({
      pageTitle: 'Grant Types',
      heading: 'Grant Types'
    })
  })

  test('answers one row per grant type, linking its code to its admin page', () => {
    expect(
      toGrantTypesPage([
        { code: 'fptt', name: 'Farming Payments' },
        { code: 'woodland', name: 'Woodland Management Plan' }
      ]).rows
    ).toEqual([
      {
        code: 'fptt',
        href: '/grant-ops/grants/fptt/admin',
        name: 'Farming Payments',
        status: '[Status]'
      },
      {
        code: 'woodland',
        href: '/grant-ops/grants/woodland/admin',
        name: 'Woodland Management Plan',
        status: '[Status]'
      }
    ])
  })

  test('shows a grant type without a name as an empty name', () => {
    expect(toGrantTypesPage([{ code: 'woodland', name: null }]).rows).toEqual([
      expect.objectContaining({ name: '' })
    ])
  })

  test('answers no rows for no grant types', () => {
    expect(toGrantTypesPage([]).rows).toEqual([])
  })

  test('escapes the grant code in the link as one path segment', () => {
    expect(
      toGrantTypesPage([{ code: 'wood land/x', name: null }]).rows
    ).toEqual([
      expect.objectContaining({
        href: '/grant-ops/grants/wood%20land%2Fx/admin'
      })
    ])
  })
})
