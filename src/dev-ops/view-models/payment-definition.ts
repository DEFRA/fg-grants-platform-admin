/**
 * How GAS resolves each mapping: `resolve-process-mapping.js`, whose test pins
 * the same cases as `payment-definition.test.ts`.
 */
const jsonataPrefix = 'jsonata:'
const rootReferencePattern =
  /^\$\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/
const rowReferencePattern =
  /^@\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/

export type MappingKind =
  | 'literal'
  | 'reference'
  | 'expression'
  | 'list'
  | 'collection'
  | 'object'

export interface MappingValue {
  text: string
  kind: MappingKind
  /** The literal `""`. */
  empty: boolean
}

/** Null where the key is absent. */
interface InvoiceLine {
  schemeCode: MappingValue | null
  description: MappingValue | null
  amountPence: MappingValue | null
  accountCode: MappingValue | null
  fundCode: MappingValue | null
  deliveryBody: MappingValue | null
  marketingYear: MappingValue | null
}

type InvoiceLineRow =
  | ({ kind: 'line' } & InvoiceLine)
  | { kind: 'from'; value: MappingValue }

type InvoiceLines =
  | { kind: 'lines'; forEach: string | null; rows: InvoiceLineRow[] }
  | { kind: 'from'; value: MappingValue }

type DuePayment =
  | {
      kind: 'due'
      title: string
      forEach: string | null
      dueDate: MappingValue | null
      totalAmountPence: MappingValue | null
      lines: InvoiceLines
    }
  | { kind: 'from'; title: string; value: MappingValue }

export interface PaymentDefinitionView {
  request: { field: string; value: MappingValue }[]
  duePayments: DuePayment[]
}

type Mapping = Record<string, unknown>

interface Item {
  value: unknown
  forEach: string | null
}

const isObject = (value: unknown): value is Mapping =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isCollection = (value: unknown): value is Mapping =>
  isObject(value) && Object.hasOwn(value, 'itemsRef')

const toStringKind = (value: string): MappingKind => {
  if (value.startsWith(jsonataPrefix)) {
    return 'expression'
  }

  return rootReferencePattern.test(value) || rowReferencePattern.test(value)
    ? 'reference'
    : 'literal'
}

const toObjectKind = (value: object): MappingKind => {
  if (Array.isArray(value)) {
    return 'list'
  }

  return isCollection(value) ? 'collection' : 'object'
}

const toKind = (value: unknown): MappingKind => {
  if (typeof value === 'string') {
    return toStringKind(value)
  }

  return value !== null && typeof value === 'object'
    ? toObjectKind(value)
    : 'literal'
}

const toMappingValue = (value: unknown): MappingValue => ({
  text: typeof value === 'string' ? value : JSON.stringify(value),
  kind: toKind(value),
  empty: value === ''
})

const toField = (mapping: Mapping, key: string): MappingValue | null =>
  Object.hasOwn(mapping, key) ? toMappingValue(mapping[key]) : null

const toForEach = (collection: Mapping): string =>
  toMappingValue(collection.itemsRef).text

/** Arrays and collections give their elements, as GAS walks them; anything else is one item. */
const toItems = (value: unknown, forEach: string | null = null): Item[] => {
  if (Array.isArray(value)) {
    return value.flatMap((element) => toItems(element, forEach))
  }

  return isCollection(value)
    ? toItems(value.items, toForEach(value))
    : [{ value, forEach }]
}

const toInvoiceLineRow = ({ value }: Item): InvoiceLineRow =>
  isObject(value)
    ? {
        kind: 'line',
        schemeCode: toField(value, 'schemeCode'),
        description: toField(value, 'description'),
        amountPence: toField(value, 'amountPence'),
        accountCode: toField(value, 'accountCode'),
        fundCode: toField(value, 'fundCode'),
        deliveryBody: toField(value, 'deliveryBody'),
        marketingYear: toField(value, 'marketingYear')
      }
    : { kind: 'from', value: toMappingValue(value) }

const toLines = (value: unknown): InvoiceLines => ({
  kind: 'lines',
  forEach: isCollection(value) ? toForEach(value) : null,
  rows: toItems(value).map(toInvoiceLineRow)
})

/** Absent is no lines; a string or other scalar is a mapping the lines come from. */
const toInvoiceLines = (value: unknown): InvoiceLines => {
  if (value === undefined) {
    return toLines([])
  }

  return value !== null && typeof value === 'object'
    ? toLines(value)
    : { kind: 'from', value: toMappingValue(value) }
}

const toDuePayment =
  (numbered: boolean) =>
  ({ value, forEach }: Item, index: number): DuePayment => {
    const title = numbered ? `Due payment ${index + 1}` : 'Due payments'

    return isObject(value)
      ? {
          kind: 'due',
          title,
          forEach,
          dueDate: toField(value, 'dueDate'),
          totalAmountPence: toField(value, 'totalAmountPence'),
          lines: toInvoiceLines(value.invoiceLines)
        }
      : { kind: 'from', title, value: toMappingValue(value) }
  }

/** Odd shapes show as they are, so the operator sees what GAS will resolve. */
export const toPaymentDefinition = (
  definition: object
): PaymentDefinitionView => {
  const { code: _code, payments, ...request } = definition as Mapping

  return {
    request: Object.entries(request).map(([field, value]) => ({
      field,
      value: toMappingValue(value)
    })),
    duePayments: toItems(payments === undefined ? [] : payments).map(
      toDuePayment(Array.isArray(payments))
    )
  }
}
