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

interface AllowListLine {
  value: string
  number: number
}

const parsedLinesIn = (value: string): AllowListLine[] =>
  value
    .split(/\r\n|\r|\n/)
    .map((line, index) => ({ value: line.trim(), number: index + 1 }))
    .filter(({ value: line }) => Boolean(line))

const linesIn = (value: string): string[] =>
  parsedLinesIn(value).map(({ value: line }) => line)

const formatFailure = (
  key: AllowListFieldKey,
  line: AllowListLine
): AllowListFieldError | undefined => {
  const { name, pattern, length } = fieldDetails[key]

  return pattern.test(line.value)
    ? undefined
    : {
        key,
        message: `${name} "${line.value}" on line ${line.number} must be exactly ${length} digits`
      }
}

const errorFor = (
  key: AllowListFieldKey,
  lines: AllowListLine[]
): AllowListFieldError[] => {
  const firstLineFor = new Map<string, number>()

  return lines.flatMap((line) => {
    const errors: AllowListFieldError[] = []
    const formatError = formatFailure(key, line)

    if (formatError) {
      errors.push(formatError)
    }

    const firstLine = firstLineFor.get(line.value)
    if (firstLine === undefined) {
      firstLineFor.set(line.value, line.number)
    } else {
      errors.push({
        key,
        message: `${fieldDetails[key].name} "${line.value}" on line ${line.number} is a duplicate of line ${firstLine}`
      })
    }

    return errors
  })
}

export const validateAllowListForm = (
  form: AllowListFormSubmission
): AllowListValidation => {
  const lines = {
    sbi: parsedLinesIn(form.sbi),
    crn: parsedLinesIn(form.crn)
  }
  const errors = fieldKeys.flatMap((key) => errorFor(key, lines[key]))

  const global = {
    sbi: lines.sbi.map(({ value }) => value),
    crn: lines.crn.map(({ value }) => value)
  }

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
