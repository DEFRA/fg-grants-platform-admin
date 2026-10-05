import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonRow } from './json-viewer.view-model.ts'

const lines = (rows: JsonRow[]) =>
  rows.flatMap((row) => (row.kind === 'end' ? [] : [[row.number, row.text]]))

const folds = (rows: JsonRow[]) =>
  rows.flatMap((row) =>
    row.kind === 'open' ? [[row.number, row.open, row.size, row.closing]] : []
  )

const items = (count: number) => Array.from({ length: count }, (_, i) => i)

describe('toJsonView', () => {
  test.each([
    ['an object', { a: 1, b: { c: [true, null, 'x'] }, d: [] }],
    ['an array', [1, { a: {} }, []]],
    ['a string', 'text'],
    ['null', null],
    ['keys and strings that need escaping', { 'a"b\n': 'c\\d\u2028', é: '<' }],
    ['a large array', { parcels: items(40) }]
  ])('draws %s line for line as JSON.stringify prints it', (_name, value) => {
    const expected = JSON.stringify(value, null, 2).split('\n')

    expect(lines(toJsonView(value).rows)).toEqual(
      expected.map((text, index) => [index + 1, text])
    )
  })

  test('folds an array of 13 items', () => {
    expect(folds(toJsonView({ list: items(13) }).rows)).toEqual([
      [1, true, '1 key', '}'],
      [2, false, '13 items', ']']
    ])
  })

  test('leaves an array of 12 items open', () => {
    expect(folds(toJsonView({ list: items(12) }).rows)[1]).toEqual([
      2,
      true,
      '12 items',
      ']'
    ])
  })

  test('never folds the document itself, however long', () => {
    expect(folds(toJsonView(items(20)).rows)).toEqual([
      [1, true, '20 items', ']']
    ])
  })

  test('numbers the lines after a folded array as the expanded document does', () => {
    const { rows } = toJsonView({ list: items(13), after: 'x' })

    expect(lines(rows).at(-2)).toEqual([17, '  "after": "x"'])
  })

  test('closes each node it opens, after its closing line', () => {
    const { rows } = toJsonView({ a: { b: 1 } })

    expect(rows.map((row) => row.kind)).toEqual([
      'open',
      'open',
      'line',
      'line',
      'end',
      'line',
      'end'
    ])
  })

  test('carries the comma a folded node is followed by', () => {
    expect(folds(toJsonView({ a: { b: 1 }, c: 2 }).rows)[1]).toEqual([
      2,
      true,
      '1 key',
      '},'
    ])
  })

  test('draws an empty object or array on one line, with nothing to fold', () => {
    expect(toJsonView({}).rows).toEqual([
      { kind: 'line', number: 1, text: '{}' }
    ])
  })
})
