import {
  contextRootsOf,
  reads,
  readsRows,
  toMappingRows,
  toMappingValue
} from './mapping-table.ts'

describe('toMappingValue', () => {
  test.each([
    ['a plain string', 'GBP', 'literal', 'fixed', 'GBP'],
    [
      'a string with a trailing space',
      '$.claim.sbi ',
      'literal',
      'fixed',
      '$.claim.sbi '
    ],
    ['a path that starts with a digit', '$.1abc', 'literal', 'fixed', '$.1abc'],
    ['a $. path', '$.claim.sbi', 'reference', 'copied', '$.claim.sbi'],
    ['an @. path', '@.dueDate', 'reference', 'copied', '@.dueDate'],
    ['an index', '$.items[0].x', 'reference', 'copied', '$.items[0].x'],
    ['a wildcard', '$.items[*]', 'reference', 'copied', '$.items[*]'],
    [
      'a jsonata: string, without its prefix',
      'jsonata:$substring($.execution.executedAt, 0, 4)',
      'expression',
      'calculated',
      '$substring($.execution.executedAt, 0, 4)'
    ],
    ['a number', 12, 'literal', 'fixed', '12'],
    ['a boolean', true, 'literal', 'fixed', 'true'],
    ['null', null, 'literal', 'fixed', 'null'],
    ['an array', ['$.a', 'b'], 'list', 'list', '["$.a","b"]'],
    [
      'an object with itemsRef',
      { itemsRef: '$.rows', items: '@.x' },
      'collection',
      'for each',
      '{"itemsRef":"$.rows","items":"@.x"}'
    ],
    ['any other object', { a: 1 }, 'object', 'fixed', '{"a":1}']
  ])(
    'reads %s the way resolve-process-mapping.js resolves it',
    (_name, value, kind, comesFrom, text) => {
      expect(toMappingValue(value)).toEqual({
        text,
        kind,
        comesFrom,
        empty: false
      })
    }
  )

  test('says the empty string, a literal, comes from nothing', () => {
    expect(toMappingValue('')).toEqual({
      text: '',
      kind: 'literal',
      comesFrom: 'empty',
      empty: true
    })
  })
})

describe('toMappingRows', () => {
  test('gives each field in the order written', () => {
    expect(
      toMappingRows({ schemeCode: 'QA-COMPLEX', startDate: '$.a.b' })
    ).toEqual([
      {
        field: 'schemeCode',
        depth: 0,
        kind: 'value',
        value: toMappingValue('QA-COMPLEX')
      },
      {
        field: 'startDate',
        depth: 0,
        kind: 'value',
        value: toMappingValue('$.a.b')
      }
    ])
  })

  test('puts the fields of an object beneath it', () => {
    expect(
      toMappingRows({ applicant: { customer: { name: '$.a.name' } } }).map(
        ({ field, depth, kind }) => [field, depth, kind]
      )
    ).toEqual([
      ['applicant', 0, 'group'],
      ['customer', 1, 'group'],
      ['name', 2, 'value']
    ])
  })

  test('says what a collection walks, with the fields of each item beneath it', () => {
    expect(
      toMappingRows({
        actions: {
          itemsRef: '$.application.annualActions',
          items: { ref: '@.ref' }
        }
      })
    ).toEqual([
      {
        field: 'actions',
        depth: 0,
        kind: 'each',
        forEach: '$.application.annualActions'
      },
      { field: 'ref', depth: 1, kind: 'value', value: toMappingValue('@.ref') }
    ])
  })

  test('gives a collection of single values one row for each item', () => {
    expect(
      toMappingRows({ refs: { itemsRef: '$.rows', items: '@.ref' } })[1]
    ).toEqual({
      field: '(each)',
      depth: 1,
      kind: 'value',
      value: toMappingValue('@.ref')
    })
  })

  test('numbers the items of a literal list from 1, beneath it', () => {
    expect(
      toMappingRows({ parcels: [{ id: 'ZZ9999-0001' }, 'ZZ9999-0002'] }).map(
        ({ field, depth, kind }) => [field, depth, kind]
      )
    ).toEqual([
      ['parcels', 0, 'list'],
      ['1', 1, 'group'],
      ['id', 2, 'value'],
      ['2', 1, 'value']
    ])
  })
})

describe('contextRootsOf', () => {
  const rootsOf = (value: unknown) => [...contextRootsOf({ value })]

  test.each([
    ['a whole reference', '$.agreement.agreementNumber', ['agreement']],
    [
      'a reference with a longer name',
      '$.agreementNumber',
      ['agreementNumber']
    ],
    ['a claim reference', '$.claim.frn', ['claim']],
    ['a row reference', '@.dueDate', []],
    ['a literal GAS does not resolve', '$.agreement.sbi ', []],
    ['an expression', 'jsonata: $.agreement.x', ['agreement']],
    ['an expression on the root', 'jsonata: $$.agreement.x', ['agreement']],
    [
      'an expression naming two roots',
      'jsonata:$.claim.total ?? $substring($.execution.executedAt, 0, 4)',
      ['claim', 'execution']
    ],
    ['a number', 12, []]
  ])('reads %s', (_name, value, roots) => {
    expect(rootsOf(value)).toEqual(roots)
  })

  test('finds a reference nested in due payments and invoice lines', () => {
    expect(
      rootsOf({
        payments: [{ invoiceLines: [{ amountPence: '$.agreement.total' }] }]
      })
    ).toEqual(['agreement'])
  })
})

describe('readsRows', () => {
  test.each([
    ['a row reference', '@.dueDate', true],
    ['a row term in an expression', 'jsonata: @.amount * 100', true],
    ['a literal that mentions one', 'see @.dueDate', false],
    ['an email-like literal', 'qa@.example', false],
    ['a root reference', '$.claim.frn', false]
  ])('says whether %s reads the row', (_name, value, expected) => {
    expect(readsRows({ value })).toBe(expected)
  })
})

describe('reads', () => {
  test('matches only values GAS resolves, never a literal', () => {
    const pattern = /\$\.agreement\.items/

    expect(reads({ a: '$.agreement.items' }, pattern)).toBe(true)
    expect(reads({ a: 'jsonata: $count($.agreement.items)' }, pattern)).toBe(
      true
    )
    expect(reads({ a: 'about $.agreement.items here' }, pattern)).toBe(false)
  })
})
