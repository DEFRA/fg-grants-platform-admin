import { getFromGas, putToGas } from '../../common/gas.ts'

export type AllowListFieldKey = 'sbi' | 'crn'

export interface AllowListFormField {
  key: AllowListFieldKey
  label: string
  value: string
  hint: string
  error?: string
}

export interface AllowListErrorSummaryItem {
  text: string
  href: string
  attributes: { 'data-error-line': number }
}

/** The allow-list screen's view, as GAS's grant-admin BFF builds it - GPA renders this directly. */
export interface AllowListView {
  sbi: AllowListFormField
  crn: AllowListFormField
  errorSummary: AllowListErrorSummaryItem[]
}

export interface AllowListFormSubmission {
  sbi: string
  crn: string
}

const allowListPath = (grantCode: string): string =>
  `/grant-admin/grants/${encodeURIComponent(grantCode)}/allow-list`

export const getGrantAllowList = async (
  grantCode: string
): Promise<AllowListView> => getFromGas<AllowListView>(allowListPath(grantCode))

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const replaceGrantAllowList = async (
  grantCode: string,
  form: AllowListFormSubmission
): Promise<AllowListView> =>
  putToGas<AllowListView>(allowListPath(grantCode), { payload: form })
