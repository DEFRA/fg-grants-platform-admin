import { toGrantQuestions } from './grant-questions.ts'
import type {
  GrantQuestionsCard,
  GrantQuestionsTab,
  SchemaField,
  SchemaTreeRow,
  Words
} from './grant-questions.ts'

/** The qa-complex 1.1.0 PRE_AWARD questions, trimmed to the parts each test reads. */
const qaComplexQuestions = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'QA complex application (TEST DATA)',
  description: 'Synthetic questions for the qa-complex test grant.',
  type: 'object',
  $defs: {
    postalAddress: {
      title: 'Postal address',
      type: 'object',
      properties: {
        line1: { type: 'string', minLength: 1, maxLength: 80 },
        postalCode: {
          type: 'string',
          description: 'Uses the reserved ZZ99 test outward code.',
          pattern: '^ZZ99 [0-9][A-Z]{2}$'
        }
      },
      required: ['line1', 'postalCode'],
      additionalProperties: false
    },
    capitalItemCode: {
      type: 'string',
      oneOf: [
        { const: 'QA-HEDGE', title: 'Hedgerow planting (test)' },
        { const: 'QA-POND', title: 'Pond creation (test)' }
      ]
    },
    pence: { type: 'integer', minimum: 0, maximum: 100000000 }
  },
  properties: {
    address: { $ref: '#/$defs/postalAddress' },
    contact: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        phone: { type: 'string' }
      },
      anyOf: [
        { properties: { email: { type: 'string' } }, required: ['email'] },
        { properties: { phone: { type: 'string' } }, required: ['phone'] }
      ],
      additionalProperties: false
    },
    farmType: {
      type: 'string',
      oneOf: [
        { const: 'ARABLE', title: 'Arable' },
        { const: 'DAIRY', title: 'Dairy' }
      ]
    },
    landUse: {
      type: 'object',
      properties: {
        arableHectares: { type: 'number', minimum: 0, maximum: 10000 },
        totalHectares: { type: 'number', exclusiveMinimum: 0, maximum: 30000 }
      },
      fgSumEquals: {
        fields: ['arableHectares', 'grasslandHectares'],
        targetField: 'totalHectares'
      }
    },
    capitalItems: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          code: { $ref: '#/$defs/capitalItemCode' },
          ratePence: { $ref: '#/$defs/pence' }
        },
        required: ['code']
      }
    },
    hasPreviousGrant: { type: 'boolean', default: false },
    previousGrantRef: { type: 'string', pattern: '^QA-PREV-[0-9]{4}$' },
    businessSize: { type: 'string', enum: ['MICRO', 'SMALL', 'MEDIUM'] },
    employeeCount: { type: 'integer', minimum: 0, maximum: 249 }
  },
  required: ['address', 'farmType'],
  if: {
    properties: { hasPreviousGrant: { const: true, type: 'boolean' } },
    required: ['hasPreviousGrant']
  },
  then: {
    properties: { previousGrantRef: { minLength: 12, type: 'string' } },
    required: ['previousGrantRef']
  },
  else: {
    not: {
      properties: { previousGrantRef: { type: 'string' } },
      required: ['previousGrantRef']
    }
  },
  allOf: [
    {
      if: {
        properties: { businessSize: { const: 'MICRO', type: 'string' } }
      },
      then: {
        properties: { employeeCount: { maximum: 9, type: 'integer' } }
      }
    }
  ],
  oneOf: [
    {
      properties: {
        businessSize: { enum: ['MICRO', 'SMALL'], type: 'string' }
      }
    },
    {
      properties: {
        businessSize: { const: 'MEDIUM', type: 'string' },
        employeeCount: { minimum: 10, type: 'integer' }
      },
      required: ['employeeCount']
    }
  ],
  fgSumMin: { fields: ['capitalItems[].quantity'], minimum: 1 },
  additionalProperties: false
}

/** Words as the page reads them, each code part in backticks. */
const said = (words: Words): string =>
  words
    .map((part) =>
      typeof part === 'string' ? part : `\`${'code' in part ? part.code : ''}\``
    )
    .join('')

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

const fieldsOf = (rows: SchemaTreeRow[]): SchemaField[] =>
  rows.flatMap((row) => ('field' in row ? [row.field] : []))

const fieldNamed = (questions: unknown, name: string): SchemaField => {
  const field = fieldsOf(schemaCard(questions).rows).find(
    (each) => each.name === name
  )

  if (!field) {
    throw new Error(`no field ${name}`)
  }

  return field
}

const onlyField = (property: unknown) =>
  fieldsOf(schemaCard({ properties: { x: property } }).rows)[0]

const constraintsOf = (property: unknown) =>
  onlyField(property).constraints.map(said)

/** Each row as one line: a group's heading, or a field's indent, name, required and constraints. */
const linesOf = (rows: SchemaTreeRow[]): string[] =>
  rows.flatMap((row) => {
    if (row.kind === 'end') {
      return []
    }

    if (row.kind === 'group') {
      return [`${row.indent}: ${said(row.heading)}`]
    }

    const { indent, name, required, constraints } = row.field

    return [
      `${indent} ${name}${required ? ' (required)' : ''} ${constraints.map(said).join(', ')}`.trim()
    ]
  })

const rulesOf = (questions: unknown): string[][] =>
  schemaCard(questions).rules.map(({ appliesTo, text, items }) => [
    said(appliesTo),
    said(text),
    ...items.map(said)
  ])

describe('toGrantQuestions phases', () => {
  test('names each phase by its name, with its code, and marks only the first as checked on submission', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', name: 'Pre-award', questions: { type: 'object' } },
      { code: 'POST_AWARD', questions: { type: 'object' } }
    )

    expect(cardsOf(tab).map((card) => [card.title, card.usedByGas])).toEqual([
      [{ code: 'PRE_AWARD', name: 'Pre-award' }, true],
      [{ code: 'POST_AWARD', name: null }, false]
    ])
  })

  test('gives a later phase without questions a card that says so', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', questions: { type: 'object' } },
      { code: 'CLOSURE', name: 'Closure' },
      { code: 'CLAIM', questions: null }
    )

    expect(cardsOf(tab).slice(1)).toEqual([
      {
        title: { code: 'CLOSURE', name: 'Closure' },
        usedByGas: false,
        kind: 'none'
      },
      {
        title: { code: 'CLAIM', name: null },
        usedByGas: false,
        kind: 'none'
      }
    ])
  })

  test.each([
    ['absent', { code: 'PRE_AWARD' }],
    ['null', { code: 'PRE_AWARD', questions: null }]
  ])('says a first phase with questions %s is missing them', (_name, phase) => {
    expect(cardsOf(withPhases(phase))).toEqual([
      {
        title: { code: 'PRE_AWARD', name: null },
        usedByGas: true,
        kind: 'missing'
      }
    ])
  })

  test.each([
    ['a string', 'object', 'not-a-schema'],
    ['an array', [{ type: 'object' }], 'not-a-schema'],
    ['true', true, 'accepts-any'],
    ['false', false, 'rejects-all']
  ])('reads questions that are %s as %s', (_name, questions, kind) => {
    expect(firstCard(questions)).toEqual({
      title: { code: 'PRE_AWARD', name: null },
      usedByGas: true,
      kind
    })
  })

  test.each([
    ['a definition that is not an object', 'grant'],
    ['phases absent', {}],
    ['phases an object', { phases: { code: 'PRE_AWARD' } }],
    ['phases empty', { phases: [] }]
  ])('says there are no phases for %s', (_name, definition) => {
    expect(toGrantQuestions(definition)).toEqual({ kind: 'no-phases' })
  })

  test('says an entry that is not an object is not one, by its place', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', questions: { type: 'object' } },
      'PRE_AWARD'
    )

    expect(cardsOf(tab)[1]).toEqual({
      title: { index: 2 },
      usedByGas: false,
      kind: 'not-an-object'
    })
  })

  test.each([
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a code that is not a string', { code: 7 }]
  ])('titles an entry with %s by its place', (_name, entry) => {
    const [card] = cardsOf(
      withPhases({ ...entry, questions: { properties: { sbi: {} } } })
    )

    expect(card).toMatchObject({
      title: { index: 1 },
      kind: 'schema'
    })
  })

  test("takes the schema's own title and description as the card's subtitle", () => {
    expect(schemaCard(qaComplexQuestions).subtitle).toBe(
      'QA complex application (TEST DATA): Synthetic questions for the qa-complex test grant.'
    )
    expect(schemaCard({ title: 'Only a title' }).subtitle).toBe('Only a title')
    expect(schemaCard({ type: 'object' }).subtitle).toBeNull()
  })
})

describe('toGrantQuestions schema tree', () => {
  test('draws each property depth first, then each if/then branch as a group of rows headed by its condition', () => {
    expect(linesOf(schemaCard(qaComplexQuestions).rows)).toEqual([
      '0 address (required)',
      '1 line1 (required) length 1–80',
      '1 postalCode (required) pattern `^ZZ99 [0-9][A-Z]{2}$`',
      '0 contact',
      '1 email',
      '1 phone',
      '0 farmType (required) one of Arable (`ARABLE`), Dairy (`DAIRY`)',
      '0 landUse',
      '1 arableHectares 0–10000',
      '1 totalHectares > 0 and ≤ 30000',
      '0 capitalItems[] 1–6 items',
      '1 code (required) one of Hedgerow planting (test) (`QA-HEDGE`), Pond creation (test) (`QA-POND`)',
      '1 ratePence 0–100000000',
      '0 hasPreviousGrant',
      '0 previousGrantRef pattern `^QA-PREV-[0-9]{4}$`',
      '0 businessSize one of `MICRO`, `SMALL`, `MEDIUM`',
      '0 employeeCount 0–249',
      '0: If `hasPreviousGrant` = true',
      '1 previousGrantRef (required) length ≥ 12',
      '0: If `businessSize` is absent or = MICRO',
      '1 employeeCount ≤ 9'
    ])
  })

  test('types a name a branch only requires by the property it names', () => {
    const { rows } = schemaCard({
      properties: { ref: { type: 'string', pattern: '^R$' }, flag: {} },
      if: { properties: { flag: { const: true } } },
      then: { required: ['ref'] }
    })

    expect(linesOf(rows).slice(-2)).toEqual([
      '0: If `flag` is absent or = true',
      '1 ref (required) pattern `^R$`'
    ])
  })

  test('nests a branch that reaches into an object', () => {
    const { rows } = schemaCard({
      properties: { farmType: { type: 'string' } },
      allOf: [
        {
          if: { properties: { farmType: { const: 'UPLAND' } } },
          then: {
            properties: {
              landUse: {
                type: 'object',
                properties: { arableHectares: { maximum: 0 } }
              }
            }
          }
        }
      ]
    })

    expect(linesOf(rows).slice(1)).toEqual([
      '0: If `farmType` is absent or = UPLAND',
      '1 landUse',
      '2 arableHectares ≤ 0'
    ])
  })

  test('indents a group inside the object it belongs to', () => {
    const { rows } = schemaCard({
      properties: {
        site: {
          type: 'object',
          properties: { visited: { type: 'boolean' }, on: {} },
          if: { properties: { visited: { const: true } } },
          then: { required: ['on'] }
        }
      }
    })

    expect(linesOf(rows)).toEqual([
      '0 site',
      '1 visited',
      '1 on',
      '1: If `visited` is absent or = true',
      '2 on (required)'
    ])
  })

  test('reads a local $ref in place, says where it came from, and keeps its description and title', () => {
    const address = fieldNamed(qaComplexQuestions, 'address')
    const postalCode = fieldNamed(qaComplexQuestions, 'postalCode')

    expect(address).toMatchObject({
      type: [{ code: 'object' }],
      title: 'Postal address',
      from: '$defs/postalAddress',
      closed: true,
      required: true
    })
    expect(postalCode.description).toBe(
      'Uses the reserved ZZ99 test outward code.'
    )
  })

  test('reads a ref into definitions too, its siblings over its target', () => {
    const field = fieldsOf(
      schemaCard({
        definitions: { pence: { type: 'integer', title: 'Pence' } },
        properties: { amount: { $ref: '#/definitions/pence', title: 'Amount' } }
      }).rows
    )[0]

    expect(field).toMatchObject({
      type: [{ code: 'integer' }],
      title: 'Amount',
      from: 'definitions/pence'
    })
  })

  test('keeps a constraint set both beside a ref and in its target, as GAS applies both', () => {
    const field = fieldNamed(
      {
        $defs: { pence: { type: 'number', minimum: 10, maximum: 500 } },
        properties: { amount: { $ref: '#/$defs/pence', minimum: 0 } }
      },
      'amount'
    )

    expect(field.constraints.map(said)).toEqual(['10–500', '≥ 0'])
  })

  test('keeps the fields and required names of both a ref and its siblings, as GAS applies both', () => {
    const { rows } = schemaCard({
      $defs: {
        address: {
          type: 'object',
          properties: { postcode: { type: 'string' } },
          required: ['postcode']
        }
      },
      properties: {
        address: {
          $ref: '#/$defs/address',
          properties: { line1: { type: 'string' } },
          required: ['line1']
        }
      }
    })

    expect(
      fieldsOf(rows).map(({ name, required }) => [name, required])
    ).toEqual([
      ['address', false],
      ['postcode', true],
      ['line1', true]
    ])
  })

  test('keeps both schemas of a field set both beside a ref and in its target', () => {
    const { rows } = schemaCard({
      $defs: {
        address: {
          type: 'object',
          properties: {
            postcode: { type: 'string', pattern: '^[A-Z]', maxLength: 8 }
          }
        }
      },
      properties: {
        address: {
          $ref: '#/$defs/address',
          properties: { postcode: { minLength: 5, maxLength: 10 } }
        }
      }
    })

    expect(
      fieldsOf(rows).map(({ name, type, constraints }) => [
        name,
        said(type),
        constraints.map(said)
      ])
    ).toEqual([
      ['address', '`object`', []],
      [
        'postcode',
        '`string`',
        ['length 5–8', 'pattern `^[A-Z]`', 'length ≤ 10']
      ]
    ])
  })

  test('keeps both schemas of a field set both beside a ref and in its target when the field has a ref too', () => {
    const { rows } = schemaCard({
      $defs: {
        pc: { type: 'string' },
        address: {
          type: 'object',
          properties: { postcode: { $ref: '#/$defs/pc', maxLength: 8 } }
        }
      },
      properties: {
        address: {
          $ref: '#/$defs/address',
          properties: { postcode: { maxLength: 5 } }
        }
      }
    })

    expect(
      fieldsOf(rows).map(({ name, type, constraints }) => [
        name,
        said(type),
        constraints.map(said)
      ])
    ).toEqual([
      ['address', '`object`', []],
      ['postcode', '`string`', ['length ≤ 8', 'length ≤ 5']]
    ])
  })

  test("keeps both sets of an array's item constraints too", () => {
    expect(
      rulesOf({
        $defs: { pence: { type: 'number', minimum: 10 } },
        properties: {
          amounts: {
            type: 'array',
            items: { $ref: '#/$defs/pence', minimum: 0 }
          }
        }
      })
    ).toEqual([['`amounts[]`', 'Each item: ≥ 10 and ≥ 0']])
  })

  test.each([
    ['remote', 'https://example.test/address.json'],
    ['missing', '#/$defs/nowhere'],
    ['not a definition', '#/properties/other']
  ])('types a %s ref as the ref itself, never as any', (_name, ref) => {
    expect(onlyField({ $ref: ref })).toMatchObject({
      type: [{ code: '$ref' }, ' ', { code: ref }],
      from: null
    })
  })

  test('stops at a ref it is already inside', () => {
    const { rows } = schemaCard({
      $defs: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/node' } }
        }
      },
      properties: { tree: { $ref: '#/$defs/node' } }
    })

    expect(fieldsOf(rows).map(({ name, type }) => [name, said(type)])).toEqual([
      ['tree', '`object`'],
      ['child', '`$ref` `#/$defs/node`']
    ])
  })

  test('stops the tree at depth 8', () => {
    const deep = (depth: number): object =>
      depth === 0
        ? { type: 'string' }
        : { type: 'object', properties: { n: deep(depth - 1) } }

    const { rows } = schemaCard({ properties: { n: deep(12) } })

    expect(Math.max(...fieldsOf(rows).map(({ indent }) => indent))).toBe(8)
    expect(fieldsOf(rows)).toHaveLength(9)
  })

  test.each([
    [{ minimum: 1, maximum: 5000 }, ['1–5000']],
    [{ exclusiveMinimum: 0, maximum: 30000 }, ['> 0 and ≤ 30000']],
    [{ minimum: 0.01 }, ['≥ 0.01']],
    [{ exclusiveMaximum: 10 }, ['< 10']],
    [{ minimum: 10, exclusiveMinimum: 0 }, ['≥ 10']],
    [{ minimum: 0, exclusiveMinimum: 0 }, ['> 0']],
    [{ maximum: 5, exclusiveMaximum: 10 }, ['≤ 5']],
    [{ maximum: 10, exclusiveMaximum: 10 }, ['< 10']],
    [{ minLength: 2, maxLength: 100 }, ['length 2–100']],
    [{ minLength: 0, maxLength: 80 }, ['length ≤ 80']],
    [{ minLength: 1 }, ['length ≥ 1']],
    [{ type: 'array', minItems: 1, maxItems: 6 }, ['1–6 items']],
    [{ type: 'array', minItems: 0 }, []],
    [{ type: 'array', minItems: 1 }, ['at least 1 item']],
    [{ type: 'array', maxItems: 3 }, ['at most 3 items']],
    [
      { multipleOf: 0.5, uniqueItems: true },
      ['multiple of 0.5', 'unique items']
    ],
    [{ enum: ['oak', 'birch'] }, ['one of `oak`, `birch`']],
    [{ const: true }, ['= `true`']],
    [{ pattern: '^[0-9]{9}$' }, ['pattern `^[0-9]{9}$`']]
  ])('reads %j as %j', (property, words) => {
    expect(constraintsOf(property)).toEqual(words)
  })

  test('reads a oneOf or anyOf of labelled consts as one of its labels, with each value as code', () => {
    expect(
      constraintsOf({
        anyOf: [
          { const: 'PASS', title: 'Passed' },
          { const: 'FAIL', title: 'Failed' }
        ]
      })
    ).toEqual(['one of Passed (`PASS`), Failed (`FAIL`)'])
  })

  test('marks an object, or an array of objects, closed when it lists every field it keeps', () => {
    const { rows } = schemaCard({
      properties: {
        open: { type: 'object', properties: { a: {} } },
        closed: {
          type: 'object',
          properties: { a: {} },
          additionalProperties: false
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { a: {} },
            additionalProperties: false
          }
        }
      }
    })

    expect(
      fieldsOf(rows)
        .filter(({ indent }) => indent === 0)
        .map(({ name, closed }) => [name, closed])
    ).toEqual([
      ['open', false],
      ['closed', true],
      ['items[]', true]
    ])
  })

  test('keeps a default for its badge, and a property with no title has none', () => {
    expect(onlyField({ type: 'boolean', default: false })).toMatchObject({
      defaultValue: 'false',
      title: null,
      description: null
    })
  })

  test.each([
    [true, 'any'],
    [false, 'not allowed'],
    ['x', 'not a schema'],
    [{ type: ['string', 'null'] }, 'string or null'],
    [{ type: 'string', format: 'date' }, 'string (date)'],
    [{ type: 'array', items: { $ref: '#/$defs/missing' } }, 'array of any'],
    [{}, 'any']
  ])('types %j as %s', (property, type) => {
    expect(said(onlyField(property).type)).toBe(`\`${type}\``)
  })
})

describe('toGrantQuestions rules', () => {
  test('words the qa-complex 1.1.0 rules as sentences, codes apart', () => {
    expect(rulesOf(qaComplexQuestions)).toEqual([
      [
        '(root) and every closed object',
        'Fields not listed under a closed object are removed on submission.'
      ],
      [
        'If `hasPreviousGrant` is absent or not true',
        '`previousGrantRef` must be left out'
      ],
      ['(root)', 'The sum of `capitalItems[].quantity` must be at least 1'],
      [
        '(root)',
        'Exactly one of these must match:',
        '`businessSize` one of `MICRO`, `SMALL`',
        '`businessSize` = `"MEDIUM"` and `employeeCount` ≥ 10 (required)'
      ],
      ['`contact`', 'Needs at least one of: `email`, `phone`'],
      [
        '`landUse`',
        '`arableHectares` + `grasslandHectares` must equal `totalHectares`'
      ]
    ])
  })

  test('says only every closed object when the root is open', () => {
    expect(
      rulesOf({
        properties: {
          a: { type: 'object', properties: {}, additionalProperties: false }
        }
      })
    ).toEqual([
      [
        'Every closed object',
        'Fields not listed under a closed object are removed on submission.'
      ]
    ])
  })

  test('has no closed line, and no default line, when nothing is closed', () => {
    expect(rulesOf({ properties: { a: { default: 1 } } })).toEqual([])
  })

  test('words the maximum sum against its target field', () => {
    expect(
      rulesOf({ fgSumMax: { fields: ['a', 'b'], targetField: 'c' } })
    ).toEqual([['(root)', '`a` + `b` must be at most `c`']])
  })

  test('shows a sum it cannot read as its JSON', () => {
    expect(rulesOf({ fgSumEquals: 'x' })).toEqual([
      ['(root)', '`fgSumEquals: "x"`']
    ])
  })

  test('heads an else by its own condition, a test of more than one value by Unless', () => {
    expect(
      rulesOf({
        type: 'object',
        if: { properties: { a: { const: 1 } }, required: ['a', 'b'] },
        then: { required: ['b'] },
        else: { required: ['c'] }
      })
    ).toEqual([['Unless `a` = 1 and `b` is present', '`c` is present']])
  })

  test('reads an else that is not only a left-out field as a sentence', () => {
    expect(
      rulesOf({
        if: { properties: { a: { const: 1 } } },
        then: { required: ['b'] },
        else: { required: ['c'] }
      })
    ).toEqual([['If `a` is present and not 1', '`c` is present']])
  })

  test('says fields left out together may still be given one at a time', () => {
    expect(
      rulesOf({
        if: { properties: { a: { const: 1 } } },
        then: { required: ['b'] },
        else: { not: { required: ['b', 'c'] } }
      })
    ).toEqual([
      [
        'If `a` is present and not 1',
        '`b` and `c` must not all be given together'
      ]
    ])
  })

  test('reads an if with only an else as unless', () => {
    expect(
      rulesOf({
        if: { required: ['a'] },
        else: { properties: { b: { minimum: 2 } } }
      })
    ).toEqual([['(root)', 'Unless `a` is present: `b` ≥ 2']])
  })

  test('adds nothing for an if with nothing to apply', () => {
    expect(rulesOf({ if: { required: ['a'] } })).toEqual([])
  })

  test('writes a then the table cannot hold as a sentence', () => {
    const card = schemaCard({
      if: { properties: { a: { enum: [1, 2] } } },
      then: { not: { required: ['b'] } }
    })

    expect(card.rows).toEqual([])
    expect(
      rulesOf({
        if: { properties: { a: { enum: [1, 2] } } },
        then: { not: { required: ['b'] } }
      })
    ).toEqual([
      ['(root)', 'If `a` is absent or one of 1, 2: `not: {"required":["b"]}`']
    ])
  })

  test('says an anyOf that is not only required names must match one of its branches', () => {
    expect(
      rulesOf({ anyOf: [{ required: ['a'] }, { properties: { b: false } }] })
    ).toEqual([
      [
        '(root)',
        'At least one of these must match:',
        '`a` is present',
        '`b` not allowed'
      ]
    ])
  })

  test('lists a leaf property’s own applicators under its path, so none is hidden', () => {
    expect(
      rulesOf({
        properties: {
          site: {
            type: 'object',
            properties: {
              outcome: {
                type: 'string',
                oneOf: [{ const: 'PASS' }, { const: 'FAIL', title: 'Failed' }],
                if: { const: 'FAIL' },
                then: { minLength: 4 },
                not: { const: 'X' }
              }
            }
          }
        }
      })
    ).toEqual([
      ['`site.outcome`', 'If `const: "FAIL"`: length ≥ 4'],
      [
        '`site.outcome`',
        'Exactly one of these must match:',
        '= `"PASS"`',
        '= `"FAIL"` and `title: "Failed"`'
      ],
      ['`site.outcome`', '`not: {"const":"X"}`']
    ])
  })

  test('names array items by their path', () => {
    expect(
      rulesOf({
        properties: {
          items: {
            type: 'array',
            items: { type: 'object', properties: {}, not: { required: ['a'] } }
          }
        }
      })
    ).toEqual([['`items[]`', '`not: {"required":["a"]}`']])
  })

  test('keeps every other applicator as its JSON', () => {
    expect(
      rulesOf({
        dependentRequired: { a: ['b'] },
        additionalProperties: { type: 'string' },
        allOf: [{ required: ['a'] }]
      })
    ).toEqual([
      ['(root)', '`{"required":["a"]}`'],
      ['(root)', '`dependentRequired: {"a":["b"]}`'],
      ['(root)', '`additionalProperties: {"type":"string"}`']
    ])
  })
})

describe('toGrantQuestions keywords no row shows', () => {
  test("lists an array's item constraints and rules under its name[]", () => {
    expect(
      rulesOf({
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', enum: ['A', 'B'], pattern: '^A' },
            contains: { const: 'A' },
            minContains: 1
          }
        }
      })
    ).toEqual([
      ['`tags`', '`contains: {"const":"A"}`'],
      ['`tags`', '`minContains: 1`'],
      ['`tags[]`', 'Each item: pattern `^A` and one of `A`, `B`']
    ])
  })

  test('lists any keyword it does not draw as its JSON, and none that only describes', () => {
    expect(
      rulesOf({
        $id: 'x',
        $comment: 'y',
        examples: [{}],
        minProperties: 1,
        maxProperties: 4,
        unevaluatedProperties: false,
        additionalProperties: { type: 'string' },
        properties: { a: { type: 'string', format: 'email', default: 'a' } }
      })
    ).toEqual([
      ['(root)', '`minProperties: 1`'],
      ['(root)', '`maxProperties: 4`'],
      ['(root)', '`unevaluatedProperties: false`'],
      ['(root)', '`additionalProperties: {"type":"string"}`']
    ])
  })

  test('lists a then or an else with no if, which GAS refuses', () => {
    expect(rulesOf({ then: { required: ['a'] } })).toEqual([
      ['(root)', '`then: {"required":["a"]}`']
    ])
  })

  test("closes an array of items that list no properties, and says what they require that they don't declare", () => {
    const questions = {
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            required: ['x'],
            additionalProperties: false
          }
        }
      }
    }

    expect(fieldNamed(questions, 'rows[]').closed).toBe(true)
    expect(rulesOf(questions)).toEqual([
      [
        'Every closed object',
        'Fields not listed under a closed object are removed on submission.'
      ],
      [
        '`rows[]`',
        "`x` is required but not declared under `properties`: GAS can't compile these questions."
      ]
    ])
  })

  test.each([
    [
      'properties that are not an object',
      { properties: 'oops' },
      '`properties: "oops"` is not an object'
    ],
    [
      'required that is not a list',
      { required: 'a', properties: { a: {} } },
      '`required: "a"` is not a list'
    ],
    [
      'a required name with no property',
      { required: ['a', 'ghost'], properties: { a: {} } },
      '`ghost` is required but not declared under `properties`'
    ]
  ])('says GAS cannot compile %s', (_name, questions, text) => {
    expect(rulesOf(questions)).toEqual([
      ['(root)', `${text}: GAS can't compile these questions.`]
    ])
  })

  test('says nothing of submission on a phase GAS does not check', () => {
    const tab = withPhases(
      { code: 'PRE_AWARD', questions: { type: 'object' } },
      {
        code: 'POST_AWARD',
        questions: { additionalProperties: false, properties: { a: {} } }
      }
    )
    const card = cardsOf(tab)[1]

    expect(card.kind === 'schema' && card.rules).toEqual([])
  })
})
