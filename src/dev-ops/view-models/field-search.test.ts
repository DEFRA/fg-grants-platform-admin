import vectors from '../../../test/fixtures/search-normalise-vectors.json' with { type: 'json' }
import {
  applicationsBucket,
  fieldsApplicationsBucket,
  fieldsCasesBucket
} from '../use-cases/test-fixtures.ts'
import {
  fieldValueError,
  isOfferedSearch,
  normaliseFieldValue,
  offeredFields,
  toFieldKind,
  toFieldsHint,
  toSearchParam
} from './field-search.ts'

const woodland = { code: 'woodland-creation' }

const businessName = {
  key: 'businessName',
  label: 'Business name',
  match: 'prefix' as const
}

const landParcelId = {
  key: 'landParcelId',
  label: 'Land parcel ID',
  match: 'exact' as const
}

describe('offeredFields', () => {
  test('are the fields the one chosen grant declares', () => {
    expect(offeredFields(fieldsApplicationsBucket, woodland)).toEqual([
      businessName,
      landParcelId
    ])
  })

  test.each([
    ['no grant is chosen', fieldsApplicationsBucket, {}],
    [
      'the chosen grant declares none',
      fieldsApplicationsBucket,
      { code: 'hedgerow-restoration' }
    ],
    [
      'the chosen grant is not in the declarations',
      fieldsApplicationsBucket,
      { code: 'constructor' }
    ],
    ['the list declares no fields', applicationsBucket, woodland],
    [
      'another filter is set',
      fieldsApplicationsBucket,
      { ...woodland, currentConfigVersion: '1.48.0' }
    ],
    [
      'a filter other than the version is set',
      fieldsApplicationsBucket,
      { ...woodland, archived: 'false' }
    ]
  ])('are none when %s', (_name, bucket, filters) => {
    expect(offeredFields(bucket, filters)).toEqual([])
  })

  test.each([
    ['a time range', { from: '2026-10-08T09:20:00.000Z', range: '24h' }],
    ['a shown toggle', { show: 'archived' }],
    ['an emptied filter', { currentConfigVersion: undefined }]
  ])('are still offered beside %s', (_name, filters) => {
    expect(
      offeredFields(fieldsApplicationsBucket, { ...woodland, ...filters })
    ).toEqual([businessName, landParcelId])
  })
})

describe('toFieldsHint', () => {
  test('asks for a grant on a list with fields and none chosen', () => {
    expect(toFieldsHint(fieldsApplicationsBucket, {})).toBe(
      'Choose a grant to search by its own fields'
    )
  })

  test('names the fact the list declares fields by', () => {
    expect(toFieldsHint(fieldsCasesBucket, {})).toBe(
      'Choose a workflow to search by its own fields'
    )
  })

  test.each([
    ['the version', { currentConfigVersion: '1.48.0' }],
    ['another filter', { archived: 'false' }]
  ])('asks to clear %s beside the chosen grant', (_name, filters) => {
    expect(
      toFieldsHint(fieldsApplicationsBucket, { ...woodland, ...filters })
    ).toBe(
      "Clear the other filters to search by woodland-creation's own fields"
    )
  })

  test.each([
    ['a grant is chosen', fieldsApplicationsBucket, woodland],
    ['the list declares no fields', applicationsBucket, {}],
    [
      'the list declares no fields and a filter is set',
      applicationsBucket,
      { ...woodland, archived: 'false' }
    ],
    [
      'the chosen grant declares none beside another filter',
      fieldsApplicationsBucket,
      { code: 'hedgerow-restoration', archived: 'false' }
    ]
  ])('says nothing when %s', (_name, bucket, filters) => {
    expect(toFieldsHint(bucket, filters)).toBeNull()
  })
})

describe('normaliseFieldValue', () => {
  test.each([
    ['O’Neill-Smith Farm', 'oneillsmithfarm'],
    ['ONEILLSMITHFARM', 'oneillsmithfarm'],
    ['SX0679 9238', 'sx06799238'],
    ['Crème Brûlée', 'cremebrulee'],
    ['--- ', '']
  ])('folds %j to %j', (value, normalised) => {
    expect(normaliseFieldValue(value)).toBe(normalised)
  })

  test.each(vectors)(
    'folds $input as GAS and CW do',
    ({ input, normalised }) => {
      expect(normaliseFieldValue(input)).toBe(normalised)
    }
  )
})

describe('fieldValueError', () => {
  test.each([
    [businessName, "O'Neill farm"],
    [businessName, 'Hil'],
    [businessName, 'ßa'],
    [landParcelId, 'SX0679 9238'],
    [landParcelId, '7'],
    [landParcelId, 'x'.repeat(200)]
  ])('takes %j %j', (field, value) => {
    expect(fieldValueError(field, value)).toBeNull()
  })

  test.each([
    [
      'over 200 characters',
      landParcelId,
      'x'.repeat(201),
      'Land parcel ID must be 200 characters or fewer'
    ],
    [
      'a control character',
      landParcelId,
      'SX06\u00079238',
      'Land parcel ID must not contain control characters'
    ],
    [
      'no letter or digit',
      landParcelId,
      '- / -',
      'Land parcel ID must contain a letter or number'
    ],
    [
      'a prefix under 3 letters or digits',
      businessName,
      "O' N",
      'Enter at least 3 letters or numbers of the business name'
    ]
  ])('refuses %s', (_name, field, value, error) => {
    expect(fieldValueError(field, value)).toBe(error)
  })
})

describe('isOfferedSearch', () => {
  test.each([
    ['a browse', ''],
    ['an identifier', 'ref:abc-123'],
    ['a field the chosen grant declares', 'field.businessName:hilltop']
  ])('keeps %s', (_name, q) => {
    expect(isOfferedSearch(fieldsApplicationsBucket, woodland, q)).toBe(true)
  })

  test.each([
    ['no grant is chosen', {}],
    ['the chosen grant does not declare it', { code: 'hedgerow-restoration' }],
    ['another filter is set', { ...woodland, currentConfigVersion: '1.48.0' }]
  ])('drops a field search when %s', (_name, filters) => {
    expect(
      isOfferedSearch(
        fieldsApplicationsBucket,
        filters,
        'field.businessName:hilltop'
      )
    ).toBe(false)
  })

  test('drops a field search on a list that declares no fields', () => {
    expect(
      isOfferedSearch(
        applicationsBucket,
        woodland,
        'field.businessName:hilltop'
      )
    ).toBe(false)
  })
})

describe('toSearchParam', () => {
  test('sends a field search as the field', () => {
    expect(toSearchParam(`${toFieldKind('landParcelId')}:SX0679 9238`)).toEqual(
      { field: 'landParcelId:SX0679 9238' }
    )
  })

  test('sends an identifier as the ref', () => {
    expect(toSearchParam('ref:abc-123')).toEqual({ ref: 'ref:abc-123' })
  })

  test('sends nothing for a browse', () => {
    expect(toSearchParam('')).toEqual({})
  })
})
