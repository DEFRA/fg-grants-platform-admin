import type { AllowListValidationDetails } from '../use-cases/gas-refusal.ts'
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
  line: number
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

// Display copy only. GAS is the sole judge of validity; this is just the
// number quoted in the message for whichever value GAS flagged as invalid.
const fieldDetails = {
  sbi: {
    name: 'SBI',
    label: 'Single Business Identifiers (SBIs)',
    length: 9
  },
  crn: {
    name: 'CRN',
    label: 'Customer Reference Numbers (CRNs)',
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

export interface ParsedAllowListForm {
  global: AllowListGlobal
  lines: Record<AllowListFieldKey, AllowListLine[]>
}

/** Splitting the submitted text into lines is presentation, not validation - it always succeeds. */
export const parseAllowListForm = (
  form: AllowListFormSubmission
): ParsedAllowListForm => {
  const lines = {
    sbi: parsedLinesIn(form.sbi),
    crn: parsedLinesIn(form.crn)
  }

  return {
    global: {
      sbi: lines.sbi.map(({ value }) => value),
      crn: lines.crn.map(({ value }) => value)
    },
    lines
  }
}

const errorsFor = (
  key: AllowListFieldKey,
  lines: AllowListLine[],
  problems: AllowListValidationDetails[AllowListFieldKey]
): AllowListFieldError[] => {
  const { name, length } = fieldDetails[key]
  const invalid = new Set(problems.invalid)
  const duplicate = new Set(problems.duplicate)
  const firstLineFor = new Map<string, number>()

  return lines.flatMap((line) => {
    const errors: AllowListFieldError[] = []

    if (invalid.has(line.value)) {
      errors.push({
        key,
        line: line.number,
        message: `${name} "${line.value}" on line ${line.number} must be exactly ${length} digits`
      })
    }

    const firstLine = firstLineFor.get(line.value)
    if (firstLine === undefined) {
      firstLineFor.set(line.value, line.number)
    } else if (duplicate.has(line.value)) {
      errors.push({
        key,
        line: line.number,
        message: `${name} "${line.value}" on line ${line.number} is a duplicate of line ${firstLine}`
      })
    }

    return errors
  })
}

/** Maps GAS's validation decision back onto the submitted lines; GPA decides nothing about validity itself. */
export const toAllowListFieldErrors = (
  { lines }: ParsedAllowListForm,
  details: AllowListValidationDetails
): AllowListFieldError[] =>
  fieldKeys.flatMap((key) => errorsFor(key, lines[key], details[key]))

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
  allowList: Pick<GrantAllowList, 'grantCode' | 'global'>,
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
  errors.map(({ key, line, message }) => ({
    text: message,
    href: `#${key}`,
    attributes: { 'data-error-line': line }
  }))
