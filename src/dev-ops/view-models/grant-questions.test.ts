import { toGrantQuestions } from './grant-questions.ts'
import type {
  GrantQuestionsCard,
  GrantQuestionsTab,
  SchemaTreeRow
} from './grant-questions.ts'

const woodlandQuestions = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['applicant', 'hectares', 'items', 'consent'],
  properties: {
    applicant: {
      type: 'object',
      title: 'Applicant details',
      required: ['business'],
      properties: {
        business: {
          type: 'object',
          title: 'Business',
          required: ['name', 'sbi'],
          properties: {
            name: { type: 'string', title: 'Business name', maxLength: 100 },
            sbi: { type: 'string', title: 'SBI', pattern: '^[0-9]{9}$' }
          }
        }
      }
    },
    hectares: { type: 'number', title: 'Area to plant (ha)', minimum: 0.5 },
    items: {
      type: 'array',
      title: 'Planting items',
      minItems: 1,
      items: {
        type: 'object',
        required: ['species', 'quantity', 'hectares'],
        properties: {
          species: {
            type: 'string',
            title: 'Species',
            enum: ['oak', 'birch', 'rowan']
          },
          quantity: { type: 'integer', title: 'Trees', minimum: 10 },
          hectares: { type: 'number', title: 'Area (ha)', minimum: 0.1 }
        }
      }
    },
    plannedStart: {
      type: 'string',
      format: 'date',
      title: 'Planned start date'
    },
    hasWoodlandPlan: {
      type: 'boolean',
      title: 'Has a woodland plan',
      default: false
    },
    planReference: {
      type: 'string',
      title: 'Woodland plan reference',
      pattern: '^WP-[0-9]{6}$'
    },
    consent: { type: 'boolean', title: 'Landowner consent given', const: true }
  },
  if: {
    properties: { hasWoodlandPlan: { const: true } },
    required: ['hasWoodlandPlan']
  },
  then: { required: ['planReference'] },
  fgSumEquals: { fields: ['items[].hectares'], targetField: 'hectares' }
}

const withPhases = (...phases: unknown[]) => toGrantQuestions({ phases })

const cardsOf = (tab: GrantQuestionsTab): GrantQuestionsCard[] =>
  tab.kind === 'cards' ? tab.cards : []

const firstCard = (questions: unknown): GrantQuestionsCard =>
  cardsOf(withPhases({ code: 'PRE_AWARD', questions }))[0]

const schemaCard = (questions: unknown) => {
  const card = firstCard(questions)

  if (card.kind !== 'schema') {
    throw new Error(`expected a schema card, got ${card.kind}`)
  }

  return card
}

const rulesOf = (questions: unknown) =>
  schemaCard(questions).rules.map(({ appliesTo, text }) => [appliesTo, text])

const ruleTextOf = (questions: object) =>
  rulesOf({ type: 'object', ...questions }).map(([, text]) => text)

const fieldsOf = (rows: SchemaTreeRow[]) =>
  rows.flatMap((row) => (row.kind === 'end' ? [] : [row.field]))

const onlyField = (property: unknown) =>
  fieldsOf(schemaCard({ properties: { x: property } }).rows)[0]

describe('toGrantQuestions phases', () => {
  test('marks only the first phase as the one GAS validates', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', questions: { type: 'object' } },
      { code: 'POST_AWARD', questions: { type: 'object' } },
      { code: 'CLAIM', questions: { type: 'object' } }
    )

    expect(cardsOf(tab).map((card) => [card.title, card.usedByGas])).toEqual([
      [{ code: 'PRE_AWARD' }, true],
      [{ code: 'POST_AWARD' }, false],
      [{ code: 'CLAIM' }, false]
    ])
  })

  test('gives a later phase without questions no card', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', questions: { type: 'object' } },
      { code: 'POST_AWARD' },
      { code: 'CLAIM', questions: null }
    )

    expect(cardsOf(tab).map((card) => card.title)).toEqual([
      { code: 'PRE_AWARD' }
    ])
  })

  test.each([
    ['absent', { code: 'PRE_AWARD' }],
    ['null', { code: 'PRE_AWARD', questions: null }]
  ])('says a first phase with questions %s is missing them', (_name, phase) => {
    expect(cardsOf(withPhases(phase))).toEqual([
      {
        title: { code: 'PRE_AWARD' },
        usedByGas: true,
        noCode: false,
        kind: 'missing'
      }
    ])
  })

  test.each([
    ['a string', 'object', 'not-a-schema'],
    ['an array', [{ type: 'object' }], 'not-a-schema'],
    ['a number', 1, 'not-a-schema'],
    ['true', true, 'accepts-any'],
    ['false', false, 'rejects-all']
  ])('reads questions that are %s as %s', (_name, questions, kind) => {
    expect(firstCard(questions)).toEqual({
      title: { code: 'PRE_AWARD' },
      usedByGas: true,
      noCode: false,
      kind
    })
  })

  test.each([
    ['a definition that is not an object', 'grant'],
    ['a definition that is null', null],
    ['phases absent', {}],
    ['phases null', { phases: null }],
    ['phases an object', { phases: { code: 'PRE_AWARD' } }],
    ['phases a string', { phases: 'PRE_AWARD' }],
    ['phases empty', { phases: [] }]
  ])('says there are no phases for %s', (_name, definition) => {
    expect(toGrantQuestions(definition)).toEqual({ kind: 'no-phases' })
  })

  test.each([
    ['a string', 'PRE_AWARD'],
    ['null', null],
    ['an array', [{ code: 'PRE_AWARD' }]]
  ])(
    'says an entry that is %s is not an object, by its place',
    (_name, entry) => {
      const tab = withPhases(
        { code: 'PRE_AWARD', questions: { type: 'object' } },
        entry
      )

      expect(cardsOf(tab)[1]).toEqual({
        title: { index: 2 },
        usedByGas: false,
        kind: 'not-an-object'
      })
    }
  )

  test.each([
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a code that is not a string', { code: 7 }]
  ])(
    'titles an entry with %s by its place, and still shows its questions',
    (_name, entry) => {
      const [card] = cardsOf(
        withPhases({
          ...entry,
          questions: { properties: { sbi: { type: 'string' } } }
        })
      )

      expect(card).toMatchObject({
        title: { index: 1 },
        noCode: true,
        kind: 'schema'
      })
      expect(card.kind === 'schema' && fieldsOf(card.rows)).toMatchObject([
        { name: 'sbi' }
      ])
    }
  )
})

describe('toGrantQuestions schema tree', () => {
  test('draws every property of woodland-creation 1.2.0, depth first, folding objects and object items', () => {
    const { rows } = schemaCard(woodlandQuestions)

    expect(
      rows.map((row) =>
        row.kind === 'end'
          ? 'end'
          : [
              row.kind,
              row.field.name,
              row.field.indent,
              row.field.type,
              row.field.title,
              row.field.required
            ]
      )
    ).toEqual([
      ['open', 'applicant', 0, 'object', 'Applicant details', true],
      ['open', 'business', 1, 'object', 'Business', true],
      ['field', 'name', 2, 'string', 'Business name', true],
      ['field', 'sbi', 2, 'string', 'SBI', true],
      'end',
      'end',
      ['field', 'hectares', 0, 'number', 'Area to plant (ha)', true],
      ['open', 'items[]', 0, 'array of object', 'Planting items', true],
      ['field', 'species', 1, 'string', 'Species', true],
      ['field', 'quantity', 1, 'integer', 'Trees', true],
      ['field', 'hectares', 1, 'number', 'Area (ha)', true],
      'end',
      [
        'field',
        'plannedStart',
        0,
        'string (date)',
        'Planned start date',
        false
      ],
      ['field', 'hasWoodlandPlan', 0, 'boolean', 'Has a woodland plan', false],
      ['field', 'planReference', 0, 'string', 'Woodland plan reference', false],
      ['field', 'consent', 0, 'boolean', 'Landowner consent given', true]
    ])
  })

  test('words each constraint and the default', () => {
    const fields = fieldsOf(schemaCard(woodlandQuestions).rows)

    expect(
      fields.map(({ name, constraints, defaultValue }) => [
        name,
        constraints,
        defaultValue
      ])
    ).toEqual([
      ['applicant', [], null],
      ['business', [], null],
      ['name', ['maxLength 100'], null],
      ['sbi', ['pattern ^[0-9]{9}$'], null],
      ['hectares', ['minimum 0.5'], null],
      ['items[]', ['minItems 1'], null],
      ['species', ['one of oak, birch, rowan'], null],
      ['quantity', ['minimum 10'], null],
      ['hectares', ['minimum 0.1'], null],
      ['plannedStart', [], null],
      ['hasWoodlandPlan', [], 'false'],
      ['planReference', ['pattern ^WP-[0-9]{6}$'], null],
      ['consent', ['= true'], null]
    ])
  })

  test('has no title where the schema gives none', () => {
    expect(onlyField({ type: 'string' }).title).toBeNull()
  })

  test.each([
    [
      'an array of a type',
      { type: 'array', items: { type: 'string' } },
      'array of string'
    ],
    [
      'an array with no item type',
      { type: 'array', items: {} },
      'array of any'
    ],
    ['an array with no items', { type: 'array' }, 'array of any'],
    ['a format', { type: 'string', format: 'email' }, 'string (email)'],
    ['a list of types', { type: ['number', 'null'] }, 'number or null'],
    ['no type', { title: 'Anything' }, 'any'],
    ['a true subschema', true, 'any'],
    ['a false subschema', false, 'not allowed'],
    ['a value that is no schema', 'string', 'not a schema']
  ])('types %s', (_name, property, type) => {
    expect(onlyField(property).type).toBe(type)
  })

  test('lists every constraint in a fixed order, whatever order the schema has', () => {
    expect(
      onlyField({
        const: 3,
        enum: [1, 2, 3],
        uniqueItems: true,
        maxItems: 9,
        minItems: 1,
        pattern: '^a$',
        maxLength: 8,
        minLength: 2,
        multipleOf: 0.5,
        exclusiveMaximum: 10,
        exclusiveMinimum: 0,
        maximum: 9,
        minimum: 1
      }).constraints
    ).toEqual([
      'minimum 1',
      'maximum 9',
      'exclusiveMinimum 0',
      'exclusiveMaximum 10',
      'multipleOf 0.5',
      'minLength 2',
      'maxLength 8',
      'pattern ^a$',
      'minItems 1',
      'maxItems 9',
      'uniqueItems true',
      'one of 1, 2, 3',
      '= 3'
    ])
  })

  test('shows a const and a default as JSON', () => {
    expect(onlyField({ const: 'yes', default: { a: [1] } })).toMatchObject({
      constraints: ['= "yes"'],
      defaultValue: '{"a":[1]}'
    })
  })

  test('takes required from the array items for their properties', () => {
    const fields = fieldsOf(
      schemaCard({
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['a'],
              properties: { a: {}, b: {} }
            }
          }
        }
      }).rows
    )

    expect(fields.map(({ name, required }) => [name, required])).toEqual([
      ['items[]', false],
      ['a', true],
      ['b', false]
    ])
  })

  test('stops indenting at depth 8, but still nests deeper', () => {
    const nested = (depth: number): object =>
      depth === 0
        ? { type: 'string' }
        : { type: 'object', properties: { [`d${depth}`]: nested(depth - 1) } }
    const { rows } = schemaCard(nested(11))

    expect(fieldsOf(rows).map(({ indent }) => indent)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8
    ])
    expect(rows.filter((row) => row.kind === 'open')).toHaveLength(10)
    expect(rows.filter((row) => row.kind === 'end')).toHaveLength(10)
  })

  test('gives a schema with no properties no rows and no rules', () => {
    expect(schemaCard({ type: 'object', properties: {} })).toMatchObject({
      rows: [],
      rules: []
    })
    expect(schemaCard({ type: 'object' })).toMatchObject({
      rows: [],
      rules: []
    })
  })
})

describe('toGrantQuestions rules', () => {
  test('lists the woodland-creation 1.2.0 rules in order', () => {
    expect(rulesOf(woodlandQuestions)).toEqual([
      ['(root)', 'Undeclared fields are removed on submission'],
      ['(root)', 'If hasWoodlandPlan = true: requires planReference'],
      ['(root)', 'fgSumEquals: sum of items[].hectares equals hectares'],
      ['hasWoodlandPlan', 'Default false filled in when missing']
    ])
  })

  test('compares a minimum sum with its minimum, and a maximum sum with its target field', () => {
    expect(
      ruleTextOf({
        fgSumMin: { fields: ['a', 'b'], minimum: 1 },
        fgSumMax: { fields: ['c'], targetField: 'total' }
      })
    ).toEqual(['fgSumMin: sum of a, b ≥ 1', 'fgSumMax: sum of c ≤ total'])
  })

  test('names nested objects and array items by their path', () => {
    expect(
      rulesOf({
        properties: {
          applicant: {
            type: 'object',
            additionalProperties: false,
            properties: { opted: { default: true } }
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { size: { default: 1 } }
            }
          }
        }
      })
    ).toEqual([
      ['applicant', 'Undeclared fields are removed on submission'],
      ['applicant.opted', 'Default true filled in when missing'],
      ['items[]', 'Undeclared fields are removed on submission'],
      ['items[].size', 'Default 1 filled in when missing']
    ])
  })

  test.each([
    [
      'a required name with no other part',
      { if: { required: ['a'] }, then: { required: ['b'] } },
      'If a is present: requires b'
    ],
    [
      'a property that must be absent',
      { if: { properties: { a: false } }, then: { required: ['b'] } },
      'If a is absent: requires b'
    ],
    [
      'two const parts',
      {
        if: { properties: { a: { const: 1 }, b: { const: 'x' } } },
        then: { required: ['c', 'd'] }
      },
      'If a = 1 and b = "x": requires c, d'
    ],
    [
      'an enum part',
      {
        if: { properties: { a: { enum: ['x', 'y'] } } },
        then: { required: ['b'] }
      },
      'If a one of x, y: requires b'
    ],
    [
      'any other property part, and any other keyword',
      {
        if: { properties: { a: { minimum: 3 } }, not: { required: ['b'] } },
        then: { properties: { c: { maxLength: 2 } }, minProperties: 1 }
      },
      'If a: {"minimum":3} and not: {"required":["b"]}: c: {"maxLength":2}; minProperties: 1'
    ],
    [
      'an else with no then',
      {
        if: { properties: { a: { const: true } } },
        else: { required: ['b'] }
      },
      'Unless a = true: requires b'
    ]
  ])('words a condition with %s', (_name, schema, text) => {
    expect(ruleTextOf(schema)).toEqual([text])
  })

  test('words the seed woodland if, then and else as GAS applies them', () => {
    expect(
      ruleTextOf({
        if: { properties: { appLandHasExistingWmp: { const: true } } },
        then: {
          required: ['existingWmps'],
          properties: { existingWmps: { type: 'string' } }
        },
        else: { properties: { existingWmps: false } }
      })
    ).toEqual([
      'If appLandHasExistingWmp = true: requires existingWmps; existingWmps: {"type":"string"}. Otherwise: existingWmps not allowed'
    ])
  })

  test('adds no rule for an if with nothing to apply', () => {
    expect(ruleTextOf({ if: { properties: { a: { const: true } } } })).toEqual(
      []
    )
  })

  test('gives every other applicator keyword a row of its own JSON', () => {
    expect(
      ruleTextOf({
        anyOf: [{ required: ['a'] }, { required: ['b'] }],
        $ref: '#/$defs/address',
        additionalProperties: { type: 'string' }
      })
    ).toEqual([
      'anyOf: [{"required":["a"]},{"required":["b"]}]',
      '$ref: "#/$defs/address"',
      'additionalProperties: {"type":"string"}'
    ])
  })
})
