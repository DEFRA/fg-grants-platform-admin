import type {
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'

export const createdNoticeKey = 'claimableItemCreated'

export interface FieldError {
  key: string
  message: string
}

export interface FormField {
  key: string
  label: string
  value: string
  type: 'number' | 'text'
  inputmode?: 'decimal' | 'numeric'
  suffix?: string
  error?: string
}

const numericUnitTypes = ['decimal', 'integer']

const collectedFields = (template: EntitlementTemplate) =>
  Object.entries(template.fields ?? {}).filter(([, field]) => field.input)

const labelOf = (field: EntitlementTemplateField, key: string) =>
  field.label ?? key

const isNumeric = (field: EntitlementTemplateField) =>
  numericUnitTypes.includes(field.unitType)

const decimalPlacesIn = (value: string) => (value.split('.')[1] ?? '').length

type Check = (
  field: EntitlementTemplateField,
  label: string,
  value: string
) => string | undefined

const firstFailure = (
  checks: Check[],
  field: EntitlementTemplateField,
  label: string,
  value: string
) => checks.map((check) => check(field, label, value)).find(Boolean)

export const notANumber: Check = (_field, label, value) => {
  const isNumber =
    /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))
  return isNumber ? undefined : `${label} must be a number`
}

const tooManyDecimalPlaces: Check = (field, label, value) =>
  field.decimalPlaces != null && decimalPlacesIn(value) > field.decimalPlaces
    ? `${label} cannot have more than ${field.decimalPlaces} decimal places`
    : undefined

const belowMinimum: Check = (field, label, value) =>
  field.minValue != null && Number(value) < field.minValue
    ? `${label} must be ${field.minValue} or greater`
    : undefined

const aboveMaximum: Check = (field, label, value) =>
  field.maxValue != null && Number(value) > field.maxValue
    ? `${label} cannot exceed ${field.maxValue}`
    : undefined

const tooShort: Check = (field, label, value) =>
  field.minLength != null && value.length < field.minLength
    ? `${label} must be at least ${field.minLength} characters`
    : undefined

const tooLong: Check = (field, label, value) =>
  field.maxLength != null && value.length > field.maxLength
    ? `${label} cannot exceed ${field.maxLength} characters`
    : undefined

const numericChecks = [
  notANumber,
  tooManyDecimalPlaces,
  belowMinimum,
  aboveMaximum
]

const textChecks = [tooShort, tooLong]

const missing = (label: string) =>
  `Enter ${label.charAt(0).toLowerCase()}${label.slice(1)}`

const errorFor = (
  field: EntitlementTemplateField,
  key: string,
  form: Record<string, string>
) => {
  const label = labelOf(field, key)
  const value = (form[key] ?? '').trim()

  if (!value) {
    return missing(label)
  }

  return firstFailure(
    isNumeric(field) ? numericChecks : textChecks,
    field,
    label,
    value
  )
}

export const validateClaimableItem = (
  template: EntitlementTemplate,
  form: Record<string, string>
): FieldError[] =>
  collectedFields(template).flatMap(([key, field]) => {
    const message = errorFor(field, key, form)

    return message ? [{ key, message }] : []
  })

const typeOf = (field: EntitlementTemplateField): FormField['type'] =>
  isNumeric(field) ? 'number' : 'text'

const inputmodeOf = (
  field: EntitlementTemplateField
): FormField['inputmode'] => {
  if (field.unitType === 'decimal') {
    return 'decimal'
  }

  if (field.unitType === 'integer') {
    return 'numeric'
  }

  return undefined
}

const suffixOf = (field: EntitlementTemplateField) => field.unit?.toLowerCase()

const messageFor = (errors: FieldError[], key: string) =>
  errors.find((error) => error.key === key)?.message

export const toClaimableItemForm = (
  template: EntitlementTemplate,
  form: Record<string, string> = {},
  errors: FieldError[] = []
): FormField[] =>
  collectedFields(template).map(([key, field]) => ({
    key,
    label: labelOf(field, key),
    value: form[key] ?? '',
    type: typeOf(field),
    inputmode: inputmodeOf(field),
    suffix: suffixOf(field),
    error: messageFor(errors, key)
  }))

export const toErrorSummary = (errors: FieldError[]) =>
  errors.map((error) => ({ text: error.message, href: `#${error.key}` }))

export const toCreatedNotice = (
  template: EntitlementTemplate,
  form: Record<string, string>
) => {
  const measured = collectedFields(template).find(([, field]) => field.unit)

  if (!measured) {
    return `${template.name} created. It is now awaiting a claim.`
  }

  const [key, field] = measured
  const value = (form[key] ?? '').trim()

  return `${template.name} of ${value} ${field.unit?.toLowerCase()} created. It is now awaiting a claim.`
}

export const toRefusalSummary = (message: string) => {
  const reason = message.endsWith('.') ? message : `${message}.`

  return [{ text: `This item cannot be added: ${reason} Please try again.` }]
}
