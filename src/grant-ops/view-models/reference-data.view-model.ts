import type {
  DbReferenceData,
  ReferenceDataItem,
  ReferenceDataSummary
} from '../use-cases/reference-data.use-case.ts'
import { toAdminHref } from './allow-list-page.view-model.ts'

export const referenceDataSavedKey = 'referenceDataSaved' as const

export type ItemFieldKey = 'code' | 'description'

export interface ItemFieldError {
  key: ItemFieldKey
  message: string
}

interface ErrorSummaryItem {
  text: string
  href: string
}

const sourceLabels: Record<ReferenceDataSummary['source'], string> = {
  inline: 'Grant definition',
  db: 'Held in GAS',
  endpoint: 'Another service'
}

const enc = encodeURIComponent

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

/** One row of the admin page's Reference data tab. Only a db set links anywhere. */
export const toReferenceDataRows = (
  code: string,
  referenceData: ReferenceDataSummary[]
) =>
  referenceData.map((summary) => ({
    name: summary.name,
    source: sourceLabels[summary.source],
    itemCount: summary.itemCount,
    href: summary.editable ? toReferenceDataHref(code, summary.name) : undefined
  }))

export const toReferenceDataPage = (
  code: string,
  set: DbReferenceData,
  saved: string | undefined
) => ({
  pageTitle: `Reference data ${set.name}`,
  code,
  name: set.name,
  adminHref: `${toAdminHref(code)}#reference-data`,
  newItemHref: toNewItemHref(code, set.name),
  saved,
  rows: set.items.map((item) => ({
    ...item,
    changeHref: toChangeItemHref(code, set.name, item.code),
    removeHref: toRemoveItemHref(code, set.name, item.code)
  }))
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
