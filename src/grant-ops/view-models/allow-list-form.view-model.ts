import type {
  AllowListGlobal,
  GrantAllowList
} from '../repositories/allow-list.repository.ts'

export interface AllowListFormSubmission {
  sbi: string
  crn: string
}

export type AllowListFieldKey = keyof AllowListFormSubmission

export interface AllowListFieldError {
  key: AllowListFieldKey
  message: string
}

export interface AllowListFormField {
  key: AllowListFieldKey
  label: string
  value: string
  hint: string
  error?: string
}

export interface AllowListForm {
  sbi: AllowListFormField
  crn: AllowListFormField
}

export type AllowListValidation =
  | { global: AllowListGlobal; errors: [] }
  | { global?: never; errors: AllowListFieldError[] }

const fieldDetails = {
  sbi: {
    name: 'SBI',
    label: 'Single Business Identifiers (SBIs)',
    pattern: /^\d{9}$/,
    length: 9
  },
  crn: {
    name: 'CRN',
    label: 'Customer Reference Numbers (CRNs)',
    pattern: /^\d{10}$/,
    length: 10
  }
} as const

const fieldKeys: AllowListFieldKey[] = ['sbi', 'crn']

const linesIn = (value: string): string[] =>
  value
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const formatFailure = (
  key: AllowListFieldKey,
  values: string[]
): string | undefined => {
  const { name, pattern, length } = fieldDetails[key]

  return values.some((value) => !pattern.test(value))
    ? `Each ${name} must be exactly ${length} digits`
    : undefined
}

const duplicateFailure = (
  key: AllowListFieldKey,
  values: string[]
): string | undefined =>
  new Set(values).size === values.length
    ? undefined
    : `Each ${fieldDetails[key].name} must be listed only once`

const errorFor = (
  key: AllowListFieldKey,
  values: string[]
): AllowListFieldError[] => {
  const failures = [
    formatFailure(key, values),
    duplicateFailure(key, values)
  ].filter((message): message is string => Boolean(message))

  return failures.length ? [{ key, message: failures.join(' and ') }] : []
}

export const validateAllowListForm = (
  form: AllowListFormSubmission
): AllowListValidation => {
  const global = {
    sbi: linesIn(form.sbi),
    crn: linesIn(form.crn)
  }
  const errors = fieldKeys.flatMap((key) => errorFor(key, global[key]))

  return errors.length ? { errors } : { global, errors: [] }
}

const countHint = (value: string): string => {
  const count = linesIn(value).length
  return `One per line. ${count} listed.`
}

const messageFor = (
  errors: AllowListFieldError[],
  key: AllowListFieldKey
): string | undefined => errors.find((error) => error.key === key)?.message

const toField = (
  key: AllowListFieldKey,
  value: string,
  errors: AllowListFieldError[]
): AllowListFormField => ({
  key,
  label: fieldDetails[key].label,
  value,
  hint: countHint(value),
  error: messageFor(errors, key)
})

export const toAllowListForm = (
  allowList: GrantAllowList,
  submitted?: AllowListFormSubmission,
  errors: AllowListFieldError[] = []
): AllowListForm => {
  const values = submitted ?? {
    sbi: allowList.global.sbi.join('\n'),
    crn: allowList.global.crn.join('\n')
  }

  return {
    sbi: toField('sbi', values.sbi, errors),
    crn: toField('crn', values.crn, errors)
  }
}

export const toAllowListErrorSummary = (errors: AllowListFieldError[]) =>
  errors.map(({ key, message }) => ({ text: message, href: `#${key}` }))
