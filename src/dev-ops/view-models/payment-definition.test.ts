import { toPaymentDefinition } from './payment-definition.ts'

/** GAS `compose/seed/woodland/1.39.1/gas/payment.json`. */
const woodland = {
  code: 'woodland',
  sbi: '$.claim.sbi',
  frn: '$.claim.frn',
  scheme: 'WMP',
  sourceSystem: 'WMP',
  deliveryBody: 'RP10',
  fesCode: 'FALS_WMP',
  originalInvoiceNumber: '',
  ledger: 'AP',
  totalAmountPence: '$.claim.totalAmountPence',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: [
    {
      dueDate: 'jsonata:$substring($.execution.executedAt, 0, 10)',
      totalAmountPence: '$.claim.totalAmountPence',
      invoiceLines: [
        {
          schemeCode: 'WMP',
          description: 'Woodland Management Plan Payment',
          amountPence: '$.claim.totalAmountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP10',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      ]
    }
  ]
}

const pmfDescription =
  'jsonata:@.description ?? $.agreement.actions[id = @.actionId].description ?? $.agreement.items[id = @.itemId].description'

/** GAS `compose/seed/pigs-might-fly/1.0.0/gas/payment.json`. */
const pigsMightFly = {
  code: 'pigs-might-fly',
  sbi: '$.agreement.identifiers.sbi',
  frn: '$.agreement.identifiers.frn',
  originalInvoiceNumber: '',
  scheme: 'SFI',
  sourceSystem: 'FPTT',
  deliveryBody: 'RP00',
  fesCode: 'FALS_FPTT',
  ledger: 'AP',
  totalAmountPence: '$.agreement.totalAmountPence',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: {
    itemsRef: '$.agreement.paymentSchedule.instalments',
    items: {
      dueDate: '@.dueDate',
      totalAmountPence: '@.totalAmountPence',
      invoiceLines: {
        itemsRef: '@.lineItems',
        items: {
          schemeCode: 'CMOR1',
          description: pmfDescription,
          amountPence: '@.amountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP00',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      }
    }
  }
}

const literal = (text: string) => ({ text, kind: 'literal', empty: false })
const reference = (text: string) => ({ text, kind: 'reference', empty: false })
const expression = (text: string) => ({
  text,
  kind: 'expression',
  empty: false
})

const duePayment = (overrides: object = {}) => ({
  dueDate: '@.dueDate',
  totalAmountPence: '@.totalAmountPence',
  invoiceLines: [],
  ...overrides
})

const withPayments = (payments: unknown) =>
  toPaymentDefinition({ code: 'woodland', payments })

const valueOf = (value: unknown) =>
  toPaymentDefinition({ code: 'woodland', currency: value }).request[0].value

describe('toPaymentDefinition', () => {
  test.each([
    ['a plain string', 'GBP', 'literal', 'GBP'],
    [
      'a string with a trailing space',
      '$.claim.sbi ',
      'literal',
      '$.claim.sbi '
    ],
    ['a path that starts with a digit', '$.1abc', 'literal', '$.1abc'],
    ['a $. path', '$.claim.sbi', 'reference', '$.claim.sbi'],
    ['an @. path', '@.dueDate', 'reference', '@.dueDate'],
    ['an index', '$.items[0].x', 'reference', '$.items[0].x'],
    ['a wildcard', '$.items[*]', 'reference', '$.items[*]'],
    [
      'a jsonata: string',
      'jsonata:$substring($.execution.executedAt, 0, 4)',
      'expression',
      'jsonata:$substring($.execution.executedAt, 0, 4)'
    ],
    ['a number', 12, 'literal', '12'],
    ['a boolean', true, 'literal', 'true'],
    ['null', null, 'literal', 'null'],
    ['an array', ['$.a', 'b'], 'list', '["$.a","b"]'],
    [
      'an object with itemsRef',
      { itemsRef: '$.rows', items: '@.x' },
      'collection',
      '{"itemsRef":"$.rows","items":"@.x"}'
    ],
    ['any other object', { a: 1 }, 'object', '{"a":1}']
  ])(
    'labels %s the way resolve-process-mapping.js resolves it',
    (_name, value, kind, text) => {
      expect(valueOf(value)).toEqual({ text, kind, empty: false })
    }
  )

  test('marks the empty string, a literal, as empty', () => {
    expect(valueOf('')).toEqual({ text: '', kind: 'literal', empty: true })
  })

  test('lists every request field in stored order, without code or payments', () => {
    const { request } = toPaymentDefinition(woodland)

    expect(request.map(({ field }) => field)).toEqual([
      'sbi',
      'frn',
      'scheme',
      'sourceSystem',
      'deliveryBody',
      'fesCode',
      'originalInvoiceNumber',
      'ledger',
      'totalAmountPence',
      'currency',
      'marketingYear'
    ])
    expect(request[0].value).toEqual(reference('$.claim.sbi'))
  })

  test('gives an array of due payments a card each, with its invoice lines', () => {
    expect(toPaymentDefinition(woodland).duePayments).toEqual([
      {
        kind: 'due',
        title: 'Due payment 1',
        forEach: null,
        dueDate: expression(
          'jsonata:$substring($.execution.executedAt, 0, 10)'
        ),
        totalAmountPence: reference('$.claim.totalAmountPence'),
        lines: {
          kind: 'lines',
          forEach: null,
          rows: [
            {
              kind: 'line',
              schemeCode: literal('WMP'),
              description: literal('Woodland Management Plan Payment'),
              amountPence: reference('$.claim.totalAmountPence'),
              accountCode: literal('SOS710'),
              fundCode: literal('DRD10'),
              deliveryBody: literal('RP10'),
              marketingYear: expression(
                'jsonata:$substring($.execution.executedAt, 0, 4)'
              )
            }
          ]
        }
      }
    ])
  })

  test('numbers each due payment of an array from 1', () => {
    expect(
      withPayments([duePayment(), duePayment()]).duePayments.map(
        ({ title }) => title
      )
    ).toEqual(['Due payment 1', 'Due payment 2'])
  })

  test('gives a collection of due payments one card, with the rows each repeats for', () => {
    const [due] = toPaymentDefinition(pigsMightFly).duePayments

    expect(due).toMatchObject({
      kind: 'due',
      title: 'Due payments',
      forEach: '$.agreement.paymentSchedule.instalments',
      dueDate: reference('@.dueDate'),
      lines: { kind: 'lines', forEach: '@.lineItems' }
    })
    expect(due).toHaveProperty('lines.rows', [
      expect.objectContaining({
        kind: 'line',
        schemeCode: literal('CMOR1'),
        description: expression(pmfDescription)
      })
    ])
  })

  test('shows due payments given as one mapping as where they come from', () => {
    expect(withPayments('$.agreement.payments').duePayments).toEqual([
      {
        kind: 'from',
        title: 'Due payments',
        value: reference('$.agreement.payments')
      }
    ])
  })

  test('shows a due payment of an array given as a mapping as where it comes from', () => {
    expect(withPayments(['$.agreement.firstInstalment']).duePayments).toEqual([
      {
        kind: 'from',
        title: 'Due payment 1',
        value: reference('$.agreement.firstInstalment')
      }
    ])
  })

  test('shows a collection whose rows are each a mapping as where they come from', () => {
    expect(
      withPayments({ itemsRef: '$.agreement.rows', items: '@.payment' })
        .duePayments
    ).toEqual([
      { kind: 'from', title: 'Due payments', value: reference('@.payment') }
    ])
  })

  test('gives each key a due payment has not got as null', () => {
    const [due] = withPayments([{ totalAmountPence: '@.total' }]).duePayments

    expect(due).toMatchObject({
      kind: 'due',
      dueDate: null,
      lines: { kind: 'lines', forEach: null, rows: [] }
    })
  })

  test('gives each key an invoice line has not got as null', () => {
    const [due] = withPayments([
      duePayment({ invoiceLines: [{ schemeCode: 'WMP' }] })
    ]).duePayments

    expect(due).toHaveProperty('lines.rows', [
      {
        kind: 'line',
        schemeCode: literal('WMP'),
        description: null,
        amountPence: null,
        accountCode: null,
        fundCode: null,
        deliveryBody: null,
        marketingYear: null
      }
    ])
  })

  test('shows due payments given as null as where they come from', () => {
    expect(withPayments(null).duePayments).toEqual([
      { kind: 'from', title: 'Due payments', value: literal('null') }
    ])
  })

  test('shows invoice lines given as null as where they come from', () => {
    const [due] = withPayments([duePayment({ invoiceLines: null })]).duePayments

    expect(due).toHaveProperty('lines', {
      kind: 'from',
      value: literal('null')
    })
  })

  test('shows invoice lines given as one mapping as where they come from', () => {
    const [due] = withPayments([
      duePayment({ invoiceLines: '@.lines' })
    ]).duePayments

    expect(due).toHaveProperty('lines', {
      kind: 'from',
      value: reference('@.lines')
    })
  })

  test('shows an invoice line given as a mapping as where it comes from', () => {
    const [due] = withPayments([
      duePayment({ invoiceLines: ['@.line'] })
    ]).duePayments

    expect(due).toHaveProperty('lines.rows', [
      { kind: 'from', value: reference('@.line') }
    ])
  })

  test.each([
    ['an empty array', []],
    ['a collection of nothing', { itemsRef: '$.rows', items: [] }],
    ['nothing at all', undefined]
  ])('gives no due payments for %s', (_name, payments) => {
    expect(withPayments(payments).duePayments).toEqual([])
  })

  test('gives no invoice lines for an empty array', () => {
    const [due] = withPayments([duePayment({ invoiceLines: [] })]).duePayments

    expect(due).toHaveProperty('lines', {
      kind: 'lines',
      forEach: null,
      rows: []
    })
  })
})
