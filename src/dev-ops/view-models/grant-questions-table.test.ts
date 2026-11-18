import { toGrantQuestions } from './grant-questions.ts'
import { toQuestionRows, toQuestionsView } from './grant-questions-table.ts'
import type { SchemaField } from './grant-questions.ts'

const sectionsOf = (questions: object) => {
  const view = toQuestionsView(
    toGrantQuestions({ phases: [{ code: 'A', questions }] })
  )

  return view.kind === 'sections' ? view.sections : []
}

const field = (name: string, indent: number): SchemaField => ({
  name,
  title: null,
  description: null,
  required: false,
  type: [{ code: 'string' }],
  constraints: [],
  defaultValue: null,
  closed: false,
  from: null,
  indent
})

describe('toQuestionRows', () => {
  test('names each property by its whole path, arrays with their brackets', () => {
    expect(
      toQuestionRows([
        { kind: 'open', field: { ...field('parcels[]', 0), closed: true } },
        { kind: 'field', field: field('id', 1) },
        { kind: 'end' },
        { kind: 'field', field: field('name', 0) }
      ]).map(({ path, closed }) => [path, closed])
    ).toEqual([
      ['parcels[]', true],
      ['parcels[].id', false],
      ['name', false]
    ])
  })

  test("says a branch's rows apply only under its condition, until a row is back at the condition's depth", () => {
    const rows = toQuestionRows([
      { kind: 'field', field: field('kind', 0) },
      {
        kind: 'group',
        heading: ['If ', { code: 'kind' }, ' is company'],
        indent: 0
      },
      {
        kind: 'field',
        field: { ...field('companyNumber', 1), constraints: [['length ', '8']] }
      },
      { kind: 'field', field: field('notes', 0) }
    ])

    expect(rows.map(({ path, constraints }) => [path, constraints])).toEqual([
      ['kind', []],
      ['companyNumber', ['only if kind is company', 'length 8']],
      ['notes', []]
    ])
  })

  test('drops a condition once its group is left, however deep a later sibling’s rows go', () => {
    const rows = toQuestionRows([
      { kind: 'open', field: field('a', 0) },
      { kind: 'group', heading: ['If x'], indent: 1 },
      { kind: 'field', field: field('onlyIfX', 2) },
      { kind: 'end' },
      { kind: 'open', field: field('b', 0) },
      { kind: 'open', field: field('c', 1) },
      { kind: 'field', field: field('deep', 2) },
      { kind: 'end' },
      { kind: 'end' }
    ])

    expect(rows.map(({ path, constraints }) => [path, constraints])).toEqual([
      ['a', []],
      ['a.onlyIfX', ['only if x']],
      ['b', []],
      ['b.c', []],
      ['b.c.deep', []]
    ])
  })

  test('keeps an outer condition on a nested group’s rows, and drops a sibling group’s', () => {
    const rows = toQuestionRows([
      { kind: 'group', heading: ['If x'], indent: 0 },
      { kind: 'open', field: field('a', 1) },
      { kind: 'group', heading: ['If y'], indent: 2 },
      { kind: 'field', field: field('both', 3) },
      { kind: 'group', heading: ['If z'], indent: 2 },
      { kind: 'field', field: field('xAndZ', 3) },
      { kind: 'end' }
    ])

    expect(rows.map(({ path, constraints }) => [path, constraints])).toEqual([
      ['a', ['only if x']],
      ['a.both', ['only if x', 'only if y']],
      ['a.xAndZ', ['only if x', 'only if z']]
    ])
  })

  test('carries each property’s title, description, $defs source and default, false, zero and empty string included', () => {
    const [section] = sectionsOf({
      type: 'object',
      $defs: { postalAddress: { type: 'object', title: 'Address' } },
      properties: {
        hasPreviousGrant: {
          type: 'boolean',
          title: 'Previous grant',
          description: 'Had a grant before',
          default: false
        },
        count: { type: 'integer', default: 0 },
        note: { type: 'string', default: '' },
        address: { $ref: '#/$defs/postalAddress' },
        plain: { type: 'string' }
      }
    })

    expect(
      section.body.kind === 'schema' &&
        section.body.rows.map(
          ({ path, title, description, from, defaultValue }) => ({
            path,
            title,
            description,
            from,
            defaultValue
          })
        )
    ).toEqual([
      {
        path: 'hasPreviousGrant',
        title: 'Previous grant',
        description: 'Had a grant before',
        from: null,
        defaultValue: 'false'
      },
      {
        path: 'count',
        title: null,
        description: null,
        from: null,
        defaultValue: '0'
      },
      {
        path: 'note',
        title: null,
        description: null,
        from: null,
        defaultValue: '""'
      },
      {
        path: 'address',
        title: 'Address',
        description: null,
        from: '$defs/postalAddress',
        defaultValue: null
      },
      {
        path: 'plain',
        title: null,
        description: null,
        from: null,
        defaultValue: null
      }
    ])
  })

  test('ties each row to its own condition only, keeping its names and values as written', () => {
    const [section] = sectionsOf({
      type: 'object',
      properties: {
        hasPreviousGrant: { type: 'boolean' },
        businessSize: { type: 'string' }
      },
      allOf: [
        {
          if: {
            properties: { hasPreviousGrant: { const: true } },
            required: ['hasPreviousGrant']
          },
          then: { properties: { previousGrantRef: { type: 'string' } } }
        },
        {
          if: {
            properties: { businessSize: { const: 'MICRO' } },
            required: ['businessSize']
          },
          then: { properties: { employeeCount: { type: 'integer' } } }
        }
      ]
    })

    expect(
      section.body.kind === 'schema' &&
        section.body.rows.map(({ path, constraints }) => [path, constraints])
    ).toEqual([
      ['hasPreviousGrant', []],
      ['businessSize', []],
      ['previousGrantRef', ['only if hasPreviousGrant = true']],
      ['employeeCount', ['only if businessSize = MICRO']]
    ])
  })
})

describe('toQuestionsView', () => {
  test('heads each phase by its name, its code when it has none, else its place', () => {
    const view = toQuestionsView(
      toGrantQuestions({
        phases: [
          {
            code: 'PRE_AWARD',
            name: 'Pre-award',
            questions: { type: 'object' }
          },
          { code: 'POST_AWARD' },
          {}
        ]
      })
    )

    expect(view).toEqual({
      kind: 'sections',
      sections: [
        {
          title: 'Pre-award',
          subtitle: null,
          checked: true,
          body: { kind: 'empty' }
        },
        {
          title: 'POST_AWARD',
          subtitle: null,
          checked: false,
          body: { kind: 'empty' }
        },
        {
          title: 'Phase 3',
          subtitle: null,
          checked: false,
          body: { kind: 'empty' }
        }
      ]
    })
  })

  test.each([
    [undefined, 'This phase has no questions: every submission throws.'],
    [false, 'These questions reject every answer.'],
    ['text', 'These questions aren’t a JSON Schema object.']
  ])(
    'says what is wrong with first-phase questions of %s',
    (questions, text) => {
      expect(
        toQuestionsView(
          toGrantQuestions({ phases: [{ code: 'A', questions }] })
        )
      ).toEqual({
        kind: 'sections',
        sections: [
          {
            title: 'A',
            subtitle: null,
            checked: true,
            body: { kind: 'problem', text }
          }
        ]
      })
    }
  )

  test('carries the phase schema’s own title and description as its subtitle', () => {
    expect(
      sectionsOf({
        type: 'object',
        title: 'Application',
        description: 'What the applicant tells us',
        properties: { name: { type: 'string' } }
      })[0].subtitle
    ).toBe('Application: What the applicant tells us')
  })

  test('says any answer is accepted for questions of true', () => {
    expect(
      toQuestionsView(
        toGrantQuestions({ phases: [{ code: 'A', questions: true }] })
      )
    ).toMatchObject({ sections: [{ body: { kind: 'any' } }] })
  })

  test('says a phase that is not an object is not one', () => {
    expect(toQuestionsView(toGrantQuestions({ phases: ['x'] }))).toMatchObject({
      sections: [
        {
          title: 'Phase 1',
          body: { kind: 'problem', text: 'This phase isn’t an object.' }
        }
      ]
    })
  })

  test('passes no phases on', () => {
    expect(toQuestionsView(toGrantQuestions({ phases: [] }))).toEqual({
      kind: 'no-phases'
    })
  })

  test('keeps the rules beside the rows, and a phase of rules alone is not empty', () => {
    const [section] = sectionsOf({
      type: 'object',
      anyOf: [{ required: ['email'] }, { required: ['phone'] }]
    })

    expect(section.body).toEqual({
      kind: 'schema',
      rows: [],
      rules: [
        {
          appliesTo: ['(root)'],
          text: [
            'Needs at least one of: ',
            { code: 'email' },
            ', ',
            { code: 'phone' }
          ],
          items: []
        }
      ]
    })
  })
})
