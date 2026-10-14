import Joi from 'joi'

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

const fieldSchema = (key: AllowListFieldKey) =>
  Joi.object({
    key: Joi.string().valid(key).required(),
    label: Joi.string().allow('').required(),
    value: Joi.string().allow('').required(),
    hint: Joi.string().allow('').required(),
    error: Joi.string().allow('')
  })
    .unknown(true)
    .required()

const viewSchema = Joi.object({
  sbi: fieldSchema('sbi'),
  crn: fieldSchema('crn'),
  errorSummary: Joi.array()
    .items(
      Joi.object({
        text: Joi.string().allow('').required(),
        href: Joi.string().allow('').required(),
        attributes: Joi.object({
          'data-error-line': Joi.number().integer().min(1).required()
        })
          .unknown(true)
          .required()
      }).unknown(true)
    )
    .required()
})
  .unknown(true)
  .required()

/** Validate GAS's rendering contract without reapplying its allow-list rules. */
export const isAllowListView = (body: unknown): body is AllowListView =>
  !viewSchema.validate(body, { convert: false }).error

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
