import { toFindOthers, toRecentLabel } from './explore-queries.view-model.ts'

describe('toRecentLabel', () => {
  test('puts a query on one line', () => {
    expect(toRecentLabel('db.cases.find(\n  {}\n)')).toBe('db.cases.find( {} )')
  })

  test('cuts it at 40 characters', () => {
    expect(toRecentLabel(`db.cases.find('${'a'.repeat(50)}')`)).toBe(
      `db.cases.find('${'a'.repeat(25)}…`
    )
  })
})

describe('toFindOthers', () => {
  test('posts each item to Explore, naming the record by its page', () => {
    expect(toFindOthers('/dev-ops/cases/woodland/CASE-1')).toEqual({
      id: 'find-others',
      action: '/dev-ops/explore',
      hidden: [{ name: 'record', value: '/dev-ops/cases/woodland/CASE-1' }],
      items: [
        {
          text: 'Applications under this business name',
          value: 'applications-by-business'
        },
        { text: 'Cases for this business, by stage', value: 'cases-by-sbi' },
        { text: 'Payments to this business', value: 'payments-by-sbi' }
      ]
    })
  })
})
