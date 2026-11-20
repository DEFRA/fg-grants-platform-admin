import type {
  ReferenceDataItem,
  ReferenceDataSummary,
  ReferenceDataView
} from '../use-cases/reference-data.use-case.ts'
import { toAdminHref } from './allow-list-page.view-model.ts'

export type ItemFieldKey = 'code' | 'description'

export interface ItemFieldError {
  key: ItemFieldKey
  message: string
}

interface ErrorSummaryItem {
  text: string
  href: string
}

const enc = encodeURIComponent

/** A service as GAS names it, such as GRANT_FUNDING_CALCULATOR, read aloud. */
const toServiceName = (service: string | undefined): string =>
  service
    ? `the ${service.toLowerCase().replaceAll('_', ' ')} service`
    : 'another service'

const toSourceLabel = ({ source, service }: ReferenceDataSummary): string => {
  if (source === 'endpoint') {
    return `From ${toServiceName(service)}`
  }

  return source === 'db' ? 'Held in GAS' : 'Set in the grant definition'
}

/** Where a change to a read-only set has to happen. */
const toChangeNote = ({ source }: ReferenceDataSummary): string | undefined => {
  if (source === 'inline') {
    return 'Changes when a new grant version is published.'
  }

  return source === 'endpoint'
    ? 'Changes in that service, not here.'
    : undefined
}

export const toReferenceDataTabHref = (code: string): string =>
  `${toAdminHref(code)}#reference-data`

export const toReferenceDataHref = (code: string, name: string): string =>
  `${toAdminHref(code)}/reference-data/${enc(name)}`

export const toNewItemHref = (code: string, name: string): string =>
  `${toReferenceDataHref(code, name)}/new`

const toItemHref = (code: string, name: string, itemCode: string): string =>
  `${toReferenceDataHref(code, name)}/items/${enc(itemCode)}`

export const toChangeItemHref = (
  code: string,
  name: string,
  itemCode: string
): string => `${toItemHref(code, name, itemCode)}/change`

export const toRemoveItemHref = (
  code: string,
  name: string,
  itemCode: string
): string => `${toItemHref(code, name, itemCode)}/remove`

const toRows = (
  code: string,
  { name, editable }: ReferenceDataSummary,
  items: ReferenceDataItem[]
) =>
  items.map((item) => ({
    ...item,
    ...(editable && {
      changeHref: toChangeItemHref(code, name, item.code),
      removeHref: toRemoveItemHref(code, name, item.code)
    })
  }))

/**
 * One section of the admin page's Reference data tab per set. Items GAS
 * already has are shown in place; an endpoint set links to a page that fetches
 * them, so the tab never waits on another service.
 */
export const toReferenceDataSections = (
  code: string,
  referenceData: ReferenceDataSummary[]
) =>
  referenceData.map((summary) => ({
    name: summary.name,
    label: toSourceLabel(summary),
    note: toChangeNote(summary),
    editable: summary.editable,
    rows: summary.items ? toRows(code, summary, summary.items) : undefined,
    addHref: summary.editable ? toNewItemHref(code, summary.name) : undefined,
    viewHref:
      summary.source === 'endpoint'
        ? toReferenceDataHref(code, summary.name)
        : undefined
  }))

export const toReferenceDataPage = (code: string, view: ReferenceDataView) => ({
  pageTitle: `Reference data ${view.name}`,
  code,
  name: view.name,
  label: toSourceLabel(view),
  note: toChangeNote(view),
  backHref: toReferenceDataTabHref(code),
  rows: toRows(code, view, view.items)
})

/** The set's service didn't answer: say so on its own page, and nowhere else. */
export const toReferenceDataUnavailablePage = (code: string, name: string) => ({
  pageTitle: `Reference data ${name}`,
  code,
  name,
  backHref: toReferenceDataTabHref(code),
  unavailable:
    "Couldn't load these items from the service right now. Try again later.",
  rows: []
})

/** Blank fields are caught here; GAS decides everything else an item may hold. */
export const validateItem = (
  form: Partial<ReferenceDataItem>,
  keys: ItemFieldKey[]
): ItemFieldError[] =>
  keys
    .filter((key) => !form[key]?.trim())
    .map((key) => ({
      key,
      message: key === 'code' ? 'Enter a code' : 'Enter a description'
    }))

/** A duplicate code is the code's fault; any other refusal names the item as a whole. */
export const toRefusalError = (
  statusCode: number,
  message: string
): ItemFieldError => ({
  key: statusCode === 409 || /"code"/.test(message) ? 'code' : 'description',
  message
})

export const toErrorSummary = (errors: ItemFieldError[]): ErrorSummaryItem[] =>
  errors.map(({ key, message }) => ({ text: message, href: `#${key}` }))

export const toItemForm = (
  form: Partial<ReferenceDataItem>,
  errors: ItemFieldError[] = []
) => {
  const errorFor = (key: ItemFieldKey) =>
    errors.find((error) => error.key === key)?.message

  return {
    code: { value: form.code ?? '', error: errorFor('code') },
    description: {
      value: form.description ?? '',
      error: errorFor('description')
    }
  }
}
