import type {
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'
import {
  toClaimableItemForm,
  toCreatedNotice,
  toErrorSummary,
  validateClaimableItem
} from './claimable-item-form.view-model.ts'

const templateOf = (
  fields: Record<string, Partial<EntitlementTemplateField>>
) =>
  ({
    claimCode: 'ENT_CS_CAPITAL_PA3',
    name: 'PA3 entitlement',
    materialised: false,
    maxEntitlements: 1,
    availableAt: { phase: 'PRE_AWARD' },
    fields
  }) as EntitlementTemplate

const hectares = (overrides: Partial<EntitlementTemplateField> = {}) =>
  templateOf({
    totalHectares: {
      input: true,
      label: 'Total area of eligible woodland',
      unitType: 'decimal',
      unit: 'HA',
      ...overrides
    }
  })

const messages = (
  template: EntitlementTemplate,
  form: Record<string, string>
) => validateClaimableItem(template, form).map((error) => error.message)

describe('validateClaimableItem', () => {
  test('accepts a value that meets every rule', () => {
    expect(
      validateClaimableItem(
        hectares({ decimalPlaces: 4, minValue: 0.5, maxValue: 100 }),
        { totalHectares: '40.25' }
      )
    ).toEqual([])
  })

  test('asks for a value that was left out', () => {
    expect(messages(hectares(), { totalHectares: '   ' })).toEqual([
      'Enter total area of eligible woodland'
    ])
    expect(messages(hectares(), {})).toHaveLength(1)
  })

  test('refuses a number it cannot read', () => {
    expect(messages(hectares(), { totalHectares: 'ten' })).toEqual([
      'Total area of eligible woodland must be a number'
    ])
  })

  test('refuses more decimal places than the definition allows', () => {
    expect(
      messages(hectares({ decimalPlaces: 2 }), { totalHectares: '1.234' })
    ).toEqual([
      'Total area of eligible woodland cannot have more than 2 decimal places'
    ])
  })

  test('refuses a value below the minimum', () => {
    expect(
      messages(hectares({ minValue: 0.5 }), { totalHectares: '-100' })
    ).toEqual(['Total area of eligible woodland must be 0.5 or greater'])
  })

  test('refuses a value above the maximum', () => {
    expect(
      messages(hectares({ maxValue: 100 }), { totalHectares: '101' })
    ).toEqual(['Total area of eligible woodland cannot exceed 100'])
  })

  test('ignores a bound the definition leaves null', () => {
    expect(
      validateClaimableItem(hectares({ minValue: null, maxValue: null }), {
        totalHectares: '-100'
      })
    ).toEqual([])
  })

  test('measures a string against its length bounds', () => {
    const reference = (overrides: Partial<EntitlementTemplateField>) =>
      templateOf({
        reference: {
          input: true,
          label: 'Reference',
          unitType: 'string',
          ...overrides
        }
      })

    expect(messages(reference({ minLength: 3 }), { reference: 'ab' })).toEqual([
      'Reference must be at least 3 characters'
    ])
    expect(
      messages(reference({ maxLength: 3 }), { reference: 'abcd' })
    ).toEqual(['Reference cannot exceed 3 characters'])
  })

  test('reads an integer field as a number', () => {
    const trees = templateOf({
      trees: {
        input: true,
        label: 'Trees',
        unitType: 'integer' as EntitlementTemplateField['unitType'],
        decimalPlaces: 0
      }
    })

    expect(messages(trees, { trees: '10.5' })).toEqual([
      'Trees cannot have more than 0 decimal places'
    ])
    expect(validateClaimableItem(trees, { trees: '10' })).toEqual([])
  })

  test('says nothing about a field the officer does not fill in', () => {
    const template = templateOf({
      fixedLength: { input: false, value: 10, unitType: 'decimal' }
    })

    expect(validateClaimableItem(template, {})).toEqual([])
  })

  test('reports every failing field, in the order they are asked for', () => {
    const template = templateOf({
      totalHectares: {
        input: true,
        label: 'Total area of eligible woodland',
        unitType: 'decimal',
        minValue: 0.5
      },
      reference: {
        input: true,
        label: 'Reference',
        unitType: 'string',
        minLength: 3
      }
    })

    expect(
      validateClaimableItem(template, { totalHectares: '0', reference: 'a' })
    ).toEqual([
      {
        key: 'totalHectares',
        message: 'Total area of eligible woodland must be 0.5 or greater'
      },
      { key: 'reference', message: 'Reference must be at least 3 characters' }
    ])
  })
})

describe('toClaimableItemForm', () => {
  test('describes a field the officer fills in', () => {
    expect(toClaimableItemForm(hectares())).toEqual([
      {
        key: 'totalHectares',
        label: 'Total area of eligible woodland',
        value: '',
        inputmode: 'decimal',
        suffix: 'ha',
        error: undefined
      }
    ])
  })

  test('leaves out a field the definition fixes', () => {
    const template = templateOf({
      totalHectares: { input: true, label: 'Area', unitType: 'decimal' },
      fixedLength: { input: false, value: 10, unitType: 'decimal' }
    })

    expect(toClaimableItemForm(template).map((field) => field.key)).toEqual([
      'totalHectares'
    ])
  })

  test('keeps what was typed and the error it earned', () => {
    const [field] = toClaimableItemForm(hectares(), { totalHectares: '-100' }, [
      { key: 'totalHectares', message: 'Must be 0.5 or greater' }
    ])

    expect(field.value).toBe('-100')
    expect(field.error).toBe('Must be 0.5 or greater')
  })
})

describe('toErrorSummary', () => {
  test('links each message to the field it belongs to', () => {
    expect(
      toErrorSummary([{ key: 'totalHectares', message: 'Enter an area' }])
    ).toEqual([{ text: 'Enter an area', href: '#totalHectares' }])
  })
})

describe('toCreatedNotice', () => {
  test('names what was created and how much of it', () => {
    expect(toCreatedNotice(hectares(), { totalHectares: '111' })).toBe(
      'PA3 entitlement of 111 ha created. It is now awaiting a claim.'
    )
  })

  test('names the entitlement alone when no field carries a unit', () => {
    const reference = templateOf({
      reference: { input: true, label: 'Reference', unitType: 'string' }
    })

    expect(toCreatedNotice(reference, { reference: 'WMP-1' })).toBe(
      'PA3 entitlement created. It is now awaiting a claim.'
    )
  })
})
