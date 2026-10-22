import {
  contextRootsOf,
  isCollection,
  isObject,
  reads,
  readsRows,
  toMappingRows,
  toMappingValue
} from './mapping-table.ts'
import type { Mapping, MappingRow, MappingValue } from './mapping-table.ts'

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
  | ({
      kind: 'line'
      /** The fields GAS calculates, opened beneath the line in full. */
      calculated: (keyof InvoiceLine)[]
    } & InvoiceLine)
  | { kind: 'from'; value: MappingValue }

type InvoiceLines =
  | { kind: 'lines'; forEach: MappingValue | null; rows: InvoiceLineRow[] }
  | { kind: 'from'; value: MappingValue }

/** `forEach` names what a collection of due payments walks; its title then says so. */
interface DueTitle {
  text: string
  forEach: string | null
}

type DuePayment =
  | {
      kind: 'due'
      title: DueTitle
      forEach: MappingValue | null
      dueDate: MappingValue | null
      totalAmountPence: MappingValue | null
      lines: InvoiceLines
    }
  | { kind: 'from'; title: DueTitle; value: MappingValue }

/** The context a payment reads, as GAS hands it over. */
type Root = 'claim' | 'agreement' | 'execution' | 'row'

export interface PaymentDefinitionView {
  /** When GAS requests this payment. */
  requestedWhen: { claim: boolean; agreement: boolean }
  /** The tabs that say more; null where that tab is not offered. */
  hrefs: PaymentContext['hrefs']
  reads: Root[]
  /** Reads both a claim and an agreement: claim payments find no agreement. */
  mixed: boolean
  version: string
  /** Reads the agreement's own rows, whose refs GAS has replaced with ids. */
  readsAgreementRows: boolean
  request: MappingRow[]
  duePayments: DuePayment[]
}

export interface PaymentContext {
  version: string
  hrefs: { entitlements: string; agreement: string | null }
}

interface Item {
  value: unknown
  forEach: MappingValue | null
}

const toField = (mapping: Mapping, key: string): MappingValue | null =>
  Object.hasOwn(mapping, key) ? toMappingValue(mapping[key]) : null

/**
 * A collection gives one item per row and an array its elements; a collection
 * or array inside one resolves to a nested list, which GAS rejects, so it
 * stays a single item.
 */
const toItems = (value: unknown): Item[] => {
  if (isCollection(value)) {
    return [{ value: value.items, forEach: toMappingValue(value.itemsRef) }]
  }

  return (Array.isArray(value) ? value : [value]).map((element) => ({
    value: element,
    forEach: null
  }))
}

/** A plain mapping of fields: neither a list nor a collection. */
const isFields = (value: unknown): value is Mapping =>
  isObject(value) && !isCollection(value)

const lineKeys: (keyof InvoiceLine)[] = [
  'schemeCode',
  'description',
  'amountPence',
  'accountCode',
  'fundCode',
  'deliveryBody',
  'marketingYear'
]

const toLine = (mapping: Mapping): InvoiceLineRow => {
  const line = Object.fromEntries(
    lineKeys.map((key) => [key, toField(mapping, key)])
  ) as unknown as InvoiceLine

  return {
    kind: 'line',
    ...line,
    calculated: lineKeys.filter((key) => line[key]?.kind === 'expression')
  }
}

const toInvoiceLineRow = ({ value }: Item): InvoiceLineRow =>
  isFields(value)
    ? toLine(value)
    : { kind: 'from', value: toMappingValue(value) }

const toLines = (value: unknown): InvoiceLines => ({
  kind: 'lines',
  forEach: isCollection(value) ? toMappingValue(value.itemsRef) : null,
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

/** A calculated list is too long for a title; its For each row gives it. */
const toCollectionTitle = ({ kind, text }: MappingValue): DueTitle =>
  kind === 'expression'
    ? {
        text: 'Due payments (one per item of the list it calculates)',
        forEach: null
      }
    : { text: 'Due payments', forEach: text }

/** "Due payment", "Due payment 2 of 3", or for a collection what it repeats for. */
const toArrayTitle = (index: number, count: number): DueTitle =>
  count > 1
    ? { text: `Due payment ${index + 1} of ${count}`, forEach: null }
    : { text: 'Due payment', forEach: null }

const toTitle = (payments: unknown, index: number, count: number): DueTitle => {
  if (isCollection(payments)) {
    return toCollectionTitle(toMappingValue(payments.itemsRef))
  }

  return Array.isArray(payments)
    ? toArrayTitle(index, count)
    : { text: 'Due payments', forEach: null }
}

const toDuePayment =
  (payments: unknown, count: number) =>
  ({ value, forEach }: Item, index: number): DuePayment => {
    const title = toTitle(payments, index, count)

    return isFields(value)
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

const knownRoots: Root[] = ['claim', 'agreement', 'execution']

const agreementRows =
  /\$\.agreement\.(?:actions|items|paymentSchedule\.instalments)/

/** Neither root read: either trigger may request it, so both are said. */
const toRequestedWhen = (
  roots: ReadonlySet<string>
): PaymentDefinitionView['requestedWhen'] => {
  const either = !roots.has('claim') && !roots.has('agreement')

  return {
    claim: either || roots.has('claim'),
    agreement: either || roots.has('agreement')
  }
}

/** Odd shapes show as they are, so the operator sees what GAS will resolve. */
export const toPaymentDefinition = (
  definition: Mapping,
  context: PaymentContext
): PaymentDefinitionView => {
  const { code: _code, payments, ...request } = definition
  const roots = contextRootsOf(definition)
  const items = toItems(payments === undefined ? [] : payments)

  return {
    requestedWhen: toRequestedWhen(roots),
    hrefs: context.hrefs,
    reads: [
      ...knownRoots.filter((root) => roots.has(root)),
      ...(readsRows(definition) ? (['row'] as const) : [])
    ],
    mixed: roots.has('claim') && roots.has('agreement'),
    version: context.version,
    readsAgreementRows: reads(definition, agreementRows),
    request: toMappingRows(request),
    duePayments: items.map(toDuePayment(payments, items.length))
  }
}
