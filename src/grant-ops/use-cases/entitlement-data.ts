import type {
  EntitlementFieldValue,
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'

const scaleDecimalAsText = (raw: string, decimalPlaces: number): number => {
  const [whole, fraction = ''] = raw.split('.')
  return Number(`${whole}${fraction.padEnd(decimalPlaces, '0')}`)
}

const toValue = (field: EntitlementTemplateField, raw: string) => {
  if (field.unitType === 'decimal') {
    return scaleDecimalAsText(raw, field.decimalPlaces ?? 0)
  }

  return field.unitType === 'integer' ? Number(raw) : raw
}

export const toEntitlementData = (
  template: EntitlementTemplate,
  form: Record<string, string>
): Record<string, EntitlementFieldValue> =>
  Object.fromEntries(
    Object.entries(template.fields ?? {})
      .filter(([, field]) => field.input)
      .map(([key, field]) => [
        key,
        { value: toValue(field, (form[key] ?? '').trim()) }
      ])
  )
