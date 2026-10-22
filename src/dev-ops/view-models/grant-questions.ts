import type { Words } from './words.ts'

export type { Words }

type Schema = Record<string, unknown>

export interface SchemaField {
  /** With `[]` after an array's name. */
  name: string
  title: string | null
  description: string | null
  required: boolean
  type: Words
  constraints: Words[]
  /** JSON text. */
  defaultValue: string | null
  /** Fields not listed under it are removed on submission. */
  closed: boolean
  /** The local definition its schema is taken from, as `$defs/postalAddress`. */
  from: string | null
  indent: number
}

export type SchemaTreeRow =
  | { kind: 'open'; field: SchemaField }
  | { kind: 'field'; field: SchemaField }
  | { kind: 'end' }
  | { kind: 'group'; heading: Words; indent: number }

export interface QuestionRule {
  appliesTo: Words
  text: Words
  /** One per alternative, under the text. */
  items: Words[]
}

/** The phase's code and name, or its 1-based place when it has no usable code. */
export type PhaseTitle =
  | { code: string; name: string | null }
  | { index: number }

interface SchemaBody {
  kind: 'schema'
  /** The root schema's own title and description. */
  subtitle: string | null
  rows: SchemaTreeRow[]
  rules: QuestionRule[]
}

type QuestionsBody =
  | SchemaBody
  | { kind: 'accepts-any' | 'rejects-all' | 'not-a-schema' }

export type GrantQuestionsCard =
  | ({ title: PhaseTitle; usedByGas: boolean } & QuestionsBody)
  | { title: PhaseTitle; usedByGas: true; kind: 'missing' }
  | { title: PhaseTitle; usedByGas: false; kind: 'none' }
  | { title: { index: number }; usedByGas: boolean; kind: 'not-an-object' }

export type GrantQuestionsTab =
  | { kind: 'cards'; cards: GrantQuestionsCard[] }
  | { kind: 'no-phases' }

/** Where a walk is: the root that holds `$defs`, the refs it has followed, and how deep it is. */
interface Walk {
  root: Schema
  seen: string[]
  depth: number
}

/** The tree stops here, so a ref that nests itself still ends. */
const maxIndent = 8

const closedRule =
  'Fields not listed under a closed object are removed on submission.'

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (value: unknown): string => JSON.stringify(value)

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : json(value)

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const code = (text: string): { code: string } => ({ code: text })

/** `a`, `b` and `c` joined by `between`. */
const joined = (parts: Words[], between: string): Words =>
  parts.flatMap((part, index) => (index === 0 ? part : [between, ...part]))

const codes = (names: string[], between = ', '): Words =>
  joined(
    names.map((name) => [code(name)]),
    between
  )

const namesIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText) : []

const propertiesOf = (schema: Schema): [string, unknown][] =>
  isSchema(schema.properties) ? Object.entries(schema.properties) : []

const localRef = /^#\/(\$defs|definitions)\/([^/]+)$/

const unescapePointer = (part: string): string =>
  part.replaceAll('~1', '/').replaceAll('~0', '~')

const definitionOf = (definitions: unknown, name: string): Schema | null => {
  const target = isSchema(definitions)
    ? definitions[unescapePointer(name)]
    : null

  return isSchema(target) ? target : null
}

const targetOf = (ref: string, root: Schema): Schema | null => {
  const [, holder, name] = localRef.exec(ref) ?? []

  return holder ? definitionOf(root[holder], name) : null
}

interface Resolved {
  schema: Schema
  from: string | null
  /** A ref that cannot be followed: remote, missing, or a cycle. */
  unresolved: string | null
  /** Constraints set both beside a ref and in its target: Ajv applies both, so neither replaces the other. */
  also: Schema | null
  walk: Walk
}

const splitSiblings = (
  target: Schema,
  siblings: Schema
): { merged: Schema; also: Schema | null } => {
  const clashing = Object.keys(siblings).filter(
    (key) => constraintKeys.has(key) && key in target
  )
  const also = Object.fromEntries(clashing.map((key) => [key, siblings[key]]))
  const kept = Object.fromEntries(
    Object.entries(siblings).filter(([key]) => !clashing.includes(key))
  )

  return {
    merged: { ...target, ...kept },
    also: clashing.length ? also : null
  }
}

/** A local `$ref` read in place, its siblings over its target but beside its constraints; any other ref is kept as it is. */
const resolve = (schema: Schema, walk: Walk): Resolved => {
  const ref = schema.$ref

  if (typeof ref !== 'string') {
    return { schema, from: null, unresolved: null, also: null, walk }
  }

  const target = walk.seen.includes(ref) ? null : targetOf(ref, walk.root)
  const { $ref: _, ...siblings } = schema

  if (!target) {
    return { schema, from: null, unresolved: ref, also: null, walk }
  }

  const { merged, also } = splitSiblings(target, siblings)

  return {
    schema: merged,
    from: ref.slice(2),
    unresolved: null,
    also,
    walk: { ...walk, seen: [...walk.seen, ref] }
  }
}

const resolved = (value: unknown, walk: Walk): Schema =>
  isSchema(value) ? resolve(value, walk).schema : {}

const typeName = (type: unknown): string => {
  if (typeof type === 'string') {
    return type
  }

  return Array.isArray(type) ? type.map(asText).join(' or ') : 'any'
}

const itemType = (items: unknown, walk: Walk): string =>
  isSchema(items) ? typeName(resolved(items, walk).type) : 'any'

const toSchemaType = (property: Schema, walk: Walk): string => {
  if (property.type === 'array') {
    return `array of ${itemType(property.items, walk)}`
  }

  return typeof property.format === 'string'
    ? `${typeName(property.type)} (${property.format})`
    : typeName(property.type)
}

const toTypeName = (property: unknown, schema: Schema, walk: Walk): string => {
  if (typeof property === 'boolean') {
    return property ? 'any' : 'not allowed'
  }

  return isSchema(property) ? toSchemaType(schema, walk) : 'not a schema'
}

const toFieldType = (
  property: unknown,
  { schema, unresolved, walk }: Resolved
): Words => {
  if (unresolved !== null) {
    return [code('$ref'), ' ', code(unresolved)]
  }

  return [code(toTypeName(property, schema, walk))]
}

const numberOf = (value: unknown): number | null =>
  typeof value === 'number' ? value : null

/** A count that bounds nothing: an absent one, or a minimum of 0. */
const countOf = (value: unknown, floor: boolean): number | null => {
  const count = numberOf(value)

  return floor && count === 0 ? null : count
}

const bound = (
  exclusive: unknown,
  inclusive: unknown,
  [strict, loose]: [string, string]
): string | null => {
  const open = numberOf(exclusive)
  const closed = numberOf(inclusive)

  if (open !== null) {
    return `${strict} ${open}`
  }

  return closed === null ? null : `${loose} ${closed}`
}

/** Both ends given and both inclusive: read as `1–5000`. */
const isClosedRange = (schema: Schema): boolean =>
  [schema.minimum, schema.maximum].every((value) => numberOf(value) !== null) &&
  [schema.exclusiveMinimum, schema.exclusiveMaximum].every(
    (value) => value === undefined
  )

const toNumberRange = (schema: Schema): Words[] => {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema

  if (isClosedRange(schema)) {
    return [[`${minimum}–${maximum}`]]
  }

  const bounds = [
    bound(exclusiveMinimum, minimum, ['>', '≥']),
    bound(exclusiveMaximum, maximum, ['<', '≤'])
  ].filter((part) => part !== null)

  return bounds.length ? [[bounds.join(' and ')]] : []
}

const toCountRange = (
  low: number | null,
  high: number | null,
  [both, atLeast, atMost]: [
    (a: number, b: number) => string,
    (a: number) => string,
    (b: number) => string
  ]
): Words[] => {
  if (low === null) {
    return high === null ? [] : [[atMost(high)]]
  }

  return high === null ? [[atLeast(low)]] : [[both(low, high)]]
}

const plural = (count: number): string => (count === 1 ? 'item' : 'items')

const toLengthRange = (schema: Schema): Words[] =>
  toCountRange(
    countOf(schema.minLength, true),
    countOf(schema.maxLength, false),
    [
      (low, high) => `length ${low}–${high}`,
      (low) => `length ≥ ${low}`,
      (high) => `length ≤ ${high}`
    ]
  )

const toItemsRange = (schema: Schema): Words[] =>
  toCountRange(
    countOf(schema.minItems, true),
    countOf(schema.maxItems, false),
    [
      (low, high) => `${low}–${high} items`,
      (low) => `at least ${low} ${plural(low)}`,
      (high) => `at most ${high} ${plural(high)}`
    ]
  )

const isLabelledConst = (
  branch: unknown
): branch is { const: unknown; title: string } =>
  isSchema(branch) &&
  branch.const !== undefined &&
  typeof branch.title === 'string' &&
  Object.keys(branch).length === 2

/** A `oneOf` or `anyOf` of `{ const, title }` only: an enum with labels. */
const labelledEnumOf = (
  schema: Schema
): { key: string; branches: { const: unknown; title: string }[] } | null => {
  const key = ['oneOf', 'anyOf'].find((name) => {
    const branches = schema[name]

    return (
      Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every(isLabelledConst)
    )
  })

  return key
    ? { key, branches: schema[key] as { const: unknown; title: string }[] }
    : null
}

const toLabelledEnum = (schema: Schema): Words[] => {
  const labelled = labelledEnumOf(schema)

  return labelled
    ? [
        [
          'one of ',
          ...joined(
            labelled.branches.map((branch) => [
              `${branch.title} (`,
              code(asText(branch.const)),
              ')'
            ]),
            ', '
          )
        ]
      ]
    : []
}

const toEnum = ({ enum: values }: Schema): Words[] =>
  Array.isArray(values) ? [['one of ', ...codes(values.map(asText))]] : []

const toConst = (schema: Schema): Words[] =>
  schema.const === undefined ? [] : [['= ', code(json(schema.const))]]

const toPattern = ({ pattern }: Schema): Words[] =>
  pattern === undefined ? [] : [['pattern ', code(asText(pattern))]]

const toOtherConstraints = ({ multipleOf, uniqueItems }: Schema): Words[] => [
  ...(multipleOf === undefined ? [] : [[`multiple of ${asText(multipleOf)}`]]),
  ...(uniqueItems === true ? [['unique items']] : [])
]

/** Read as ranges and lists, not keyword by keyword. */
const toConstraints = (schema: Schema): Words[] => [
  ...toNumberRange(schema),
  ...toLengthRange(schema),
  ...toItemsRange(schema),
  ...toPattern(schema),
  ...toEnum(schema),
  ...toLabelledEnum(schema),
  ...toConst(schema),
  ...toOtherConstraints(schema)
]

const toResolvedConstraints = ({
  schema,
  also
}: Pick<Resolved, 'schema' | 'also'>): Words[] => [
  ...toConstraints(schema),
  ...(also ? toConstraints(also) : [])
]

const defaultOf = (property: Schema): string | null =>
  property.default === undefined ? null : json(property.default)

/** Where a property's children and rules sit: the property itself, or its array's items. */
interface Scope {
  schema: Schema
  walk: Walk
  suffix: '' | '[]'
  /** The items' constraints set both beside their ref and in its target. */
  also: Schema | null
}

const declaresFields = (schema: Schema): boolean =>
  ['properties', 'required', 'additionalProperties'].some(
    (key) => schema[key] !== undefined
  )

const scopeOf = (property: Schema, walk: Walk): Scope | null => {
  if (isSchema(property.items)) {
    const items = resolve(property.items, walk)

    return {
      schema: items.schema,
      walk: items.walk,
      suffix: '[]',
      also: items.also
    }
  }

  return declaresFields(property)
    ? { schema: property, walk, suffix: '', also: null }
    : null
}

/** The scope a property's rows open into: only one with fields to list. */
const childrenOf = (property: Schema, walk: Walk): Scope | null => {
  const scope = scopeOf(property, walk)

  return scope && isSchema(scope.schema.properties) ? scope : null
}

const toField = (
  name: string,
  property: unknown,
  required: boolean,
  found: Resolved
): SchemaField => {
  const { schema, from, walk } = found

  return {
    name: schema.type === 'array' ? `${name}[]` : name,
    title: textOf(schema.title),
    description: textOf(schema.description),
    required,
    type: toFieldType(property, found),
    constraints: toResolvedConstraints(found),
    defaultValue: defaultOf(schema),
    closed: scopeOf(schema, walk)?.schema.additionalProperties === false,
    from,
    indent: walk.depth
  }
}

const deeper = (walk: Walk): Walk => ({ ...walk, depth: walk.depth + 1 })

const toPropertyRows = (
  name: string,
  property: unknown,
  required: boolean,
  walk: Walk
): SchemaTreeRow[] => {
  const found = resolve(isSchema(property) ? property : {}, walk)
  const field = toField(name, property, required, found)
  const children =
    walk.depth < maxIndent ? childrenOf(found.schema, found.walk) : null

  return children
    ? [
        { kind: 'open', field },
        ...toScopeRows(children.schema, deeper(children.walk)),
        { kind: 'end' }
      ]
    : [{ kind: 'field', field }]
}

const toPropertiesRows = (schema: Schema, walk: Walk): SchemaTreeRow[] => {
  const required = namesIn(schema.required)

  return propertiesOf(schema).flatMap(([name, property]) =>
    toPropertyRows(name, property, required.includes(name), walk)
  )
}

const toValueCondition = (property: Schema): Words | null => {
  if (property.const !== undefined) {
    return [` = ${asText(property.const)}`]
  }

  return Array.isArray(property.enum)
    ? [` one of ${property.enum.map(asText).join(', ')}`]
    : null
}

const toValuePart = (property: unknown): Words =>
  (isSchema(property) ? toValueCondition(property) : null) ?? [
    ': ',
    code(json(property))
  ]

/** Ajv passes a property's part when the property is absent, unless the condition requires it. */
const toConditionPart = (
  name: string,
  property: unknown,
  required: boolean
): Words => {
  if (property === false) {
    return [code(name), ' is absent']
  }

  return [
    code(name),
    ...(required ? [] : [' is absent or']),
    ...toValuePart(property)
  ]
}

/** As Ajv reads `if`: a required name with a part of its own folds into it. */
const toCondition = (condition: unknown): Words => {
  if (!isSchema(condition)) {
    return [code(json(condition))]
  }

  const properties = propertiesOf(condition)
  const named = new Set(properties.map(([name]) => name))
  const required = namesIn(condition.required)
  const others = Object.entries(condition).filter(
    ([key]) => key !== 'properties' && key !== 'required'
  )

  return joined(
    [
      ...properties.map(([name, property]) =>
        toConditionPart(name, property, required.includes(name))
      ),
      ...required
        .filter((name) => !named.has(name))
        .map((name) => [code(name), ' is present']),
      ...others.map(([key, value]) => [code(`${key}: ${json(value)}`)])
    ],
    ' and '
  )
}

const branchKeys = new Set(['properties', 'required', 'type'])

/** The keywords a branch's own constraints are read from. */
const constraintKeys = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'enum',
  'const',
  'multipleOf',
  'uniqueItems'
])

/** A branch the Property table can hold: only properties and required names. */
const isTabular = (branch: unknown): branch is Schema =>
  isSchema(branch) && Object.keys(branch).every((key) => branchKeys.has(key))

/** Each name the branch requires or constrains, typed by the scope where the branch has no part for it. */
const toBranchRows = (
  branch: Schema,
  scope: Schema,
  walk: Walk
): SchemaTreeRow[] => {
  const own = isSchema(branch.properties) ? branch.properties : {}
  const outer = isSchema(scope.properties) ? scope.properties : {}
  const required = namesIn(branch.required)
  const names = [...new Set([...Object.keys(own), ...required])]

  return names.flatMap((name) =>
    toPropertyRows(
      name,
      own[name] ?? outer[name] ?? {},
      required.includes(name),
      walk
    )
  )
}

const toPropertyPhrase = (
  name: string,
  property: unknown,
  walk: Walk
): Words => {
  if (property === false) {
    return [code(name), ' not allowed']
  }

  const constraints = toResolvedConstraints(
    resolve(isSchema(property) ? property : {}, walk)
  )

  return constraints.length
    ? [code(name), ' ', ...joined(constraints, ' and ')]
    : [code(name), ': ', code(json(property))]
}

/** A branch as a sentence: what each named field must be, and which are required. */
const toBranchSentence = (branch: unknown, walk: Walk): Words => {
  if (!isSchema(branch)) {
    return [code(json(branch))]
  }

  const required = namesIn(branch.required)
  const named = propertiesOf(branch).map(([name]) => name)
  const others = Object.entries(branch).filter(
    ([key]) => !branchKeys.has(key) && !constraintKeys.has(key)
  )

  return joined(
    [
      ...propertiesOf(branch).map(([name, property]) => [
        ...toPropertyPhrase(name, property, walk),
        ...(required.includes(name) ? [' (required)'] : [])
      ]),
      ...required
        .filter((name) => !named.includes(name))
        .map((name) => [code(name), ' is present']),
      ...toConstraints(branch),
      ...others.map(([key, value]) => [code(`${key}: ${json(value)}`)])
    ],
    ' and '
  )
}

/** `not { required: [x] }`, with at most a type for x: x must be left out. */
const onlyNot = (otherwise: unknown): unknown =>
  isSchema(otherwise) && Object.keys(otherwise).length === 1
    ? otherwise.not
    : null

const leftOutOf = (otherwise: unknown): string[] | null => {
  const not = onlyNot(otherwise)
  const names = isTabular(not) ? namesIn(not.required) : []

  return names.length ? names : null
}

interface ScopeOut {
  groups: SchemaTreeRow[]
  rules: QuestionRule[]
}

const noOut: ScopeOut = { groups: [], rules: [] }

const rule = (
  appliesTo: Words,
  text: Words,
  items: Words[] = []
): QuestionRule => ({
  appliesTo,
  text,
  items
})

const hasConst = (property: unknown): property is Schema =>
  isSchema(property) && property.const !== undefined

/** Nothing else in the condition: no other key, and no other name required. */
const testsOnly = (condition: Schema, name: string): boolean =>
  Object.keys(condition).every((key) =>
    ['properties', 'required'].includes(key)
  ) && namesIn(condition.required).every((required) => required === name)

const onlyPropertyOf = (condition: unknown): [string, unknown] | null => {
  const properties = isSchema(condition) ? propertiesOf(condition) : []

  return properties.length === 1 ? properties[0] : null
}

const singleConstOf = (condition: unknown): [string, Schema] | null => {
  const [name, property] = onlyPropertyOf(condition) ?? ['', undefined]

  return hasConst(property) && testsOnly(condition as Schema, name)
    ? [name, property]
    : null
}

/** `if` fails on an absent name only when it requires the name. */
const toNegatedConst = (condition: Schema, name: string): string =>
  namesIn(condition.required).includes(name)
    ? ' is absent or not '
    : ' is present and not '

/** When `else` applies, said as its own condition, so it never sits beside the `if` it is the opposite of. */
const toElseHeading = (condition: unknown): Words => {
  const single = singleConstOf(condition)

  return single
    ? [
        'If ',
        code(single[0]),
        toNegatedConst(condition as Schema, single[0]),
        asText(single[1].const)
      ]
    : ['Unless ', ...toCondition(condition)]
}

/** `not: { required }` forbids only all of them together: one may still be given. */
const toLeftOut = (names: string[]): Words =>
  names.length === 1
    ? [...codes(names), ' must be left out']
    : [...codes(names, ' and '), ' must not all be given together']

const toElse = (
  condition: unknown,
  otherwise: unknown,
  walk: Walk
): QuestionRule[] => {
  if (otherwise === undefined) {
    return []
  }

  const leftOut = leftOutOf(otherwise)

  return [
    rule(
      toElseHeading(condition),
      leftOut ? toLeftOut(leftOut) : toBranchSentence(otherwise, walk)
    )
  ]
}

/** Ajv applies `else` whenever `if` fails, with or without `then`; a lone `if` does nothing. */
const toUnless = (
  condition: unknown,
  otherwise: unknown,
  at: Words,
  walk: Walk
): ScopeOut =>
  otherwise === undefined
    ? noOut
    : {
        groups: [],
        rules: [
          rule(at, [
            'Unless ',
            ...toCondition(condition),
            ': ',
            ...toBranchSentence(otherwise, walk)
          ])
        ]
      }

const groupable = (then: unknown, tabulate: boolean): then is Schema =>
  tabulate && isTabular(then)

/** `if`/`then` as a group of rows headed by its condition; `else` and anything untabular as Rules. */
const toConditional = (
  schema: Schema,
  scope: Schema,
  at: Words,
  walk: Walk,
  tabulate: boolean
): ScopeOut => {
  const { if: condition, then, else: otherwise } = schema

  if (condition === undefined) {
    return noOut
  }

  const heading: Words = ['If ', ...toCondition(condition)]

  if (then === undefined) {
    return toUnless(condition, otherwise, at, walk)
  }

  return groupable(then, tabulate)
    ? {
        groups: [
          { kind: 'group', heading, indent: Math.min(walk.depth, maxIndent) },
          ...toBranchRows(then, scope, deeper(walk))
        ],
        rules: toElse(condition, otherwise, walk)
      }
    : {
        groups: [],
        rules: [
          rule(at, [...heading, ': ', ...toBranchSentence(then, walk)]),
          ...toElse(condition, otherwise, walk)
        ]
      }
}

const merge = (outs: ScopeOut[]): ScopeOut => ({
  groups: outs.flatMap(({ groups }) => groups),
  rules: outs.flatMap(({ rules }) => rules)
})

const isRequiredOnly = (branch: unknown): boolean =>
  isTabular(branch) &&
  namesIn(branch.required).length > 0 &&
  propertiesOf(branch).every(
    ([, property]) =>
      isSchema(property) && Object.keys(property).every((key) => key === 'type')
  )

const toAnyOf = (branches: unknown[], at: Words, walk: Walk): QuestionRule =>
  branches.every(isRequiredOnly)
    ? rule(at, [
        'Needs at least one of: ',
        ...joined(
          branches.map((branch) =>
            codes(namesIn((branch as Schema).required), ' and ')
          ),
          ', '
        )
      ])
    : rule(
        at,
        ['At least one of these must match:'],
        branches.map((branch) => toBranchSentence(branch, walk))
      )

const toAllOf = (
  members: unknown[],
  scope: Schema,
  at: Words,
  walk: Walk,
  tabulate: boolean
): ScopeOut =>
  merge(
    members.map((member) =>
      isSchema(member) &&
      member.if !== undefined &&
      Object.keys(member).every((key) => ['if', 'then', 'else'].includes(key))
        ? toConditional(member, scope, at, walk, tabulate)
        : { groups: [], rules: [rule(at, [code(json(member))])] }
    )
  )

const sumRules: Record<string, (sum: Schema) => Words> = {
  fgSumEquals: (sum) => [
    ...codes(namesIn(sum.fields), ' + '),
    ' must equal ',
    code(asText(sum.targetField))
  ],
  fgSumMin: (sum) => [
    'The sum of ',
    ...codes(namesIn(sum.fields), ' + '),
    ` must be at least ${asText(sum.minimum)}`
  ],
  fgSumMax: (sum) => [
    ...codes(namesIn(sum.fields), ' + '),
    ' must be at most ',
    code(asText(sum.targetField))
  ]
}

const toSumRules = (schema: Schema, at: Words): QuestionRule[] =>
  Object.entries(sumRules)
    .filter(([key]) => schema[key] !== undefined)
    .map(([key, words]) => {
      const sum = schema[key]

      return rule(
        at,
        isSchema(sum) && Array.isArray(sum.fields)
          ? words(sum)
          : [code(`${key}: ${json(sum)}`)]
      )
    })

const listOf = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null

/** Keywords that only describe, so GAS applies nothing for them. */
const descriptiveKeys = [
  'type',
  'title',
  'description',
  '$schema',
  '$id',
  '$comment',
  'examples',
  'format',
  'default',
  '$defs',
  'definitions'
]

/** Keywords drawn as rows, constraints or their own rules. */
const shownKeys = new Set([
  ...descriptiveKeys,
  ...constraintKeys,
  ...Object.keys(sumRules),
  'properties',
  'required',
  'items',
  'if'
])

const followsIf = (_value: unknown, schema: Schema): boolean =>
  schema.if !== undefined

/** Keywords drawn only in their usual shape: `then` and `else` under an `if`, lists of branches, a closed object. */
const shownWhen: Record<string, (value: unknown, schema: Schema) => boolean> = {
  then: followsIf,
  else: followsIf,
  allOf: Array.isArray,
  oneOf: Array.isArray,
  anyOf: Array.isArray,
  additionalProperties: (value) => value === false
}

const isShown = (schema: Schema, key: string, value: unknown): boolean =>
  shownKeys.has(key) || (shownWhen[key]?.(value, schema) ?? false)

/** Every other keyword, shown as JSON, so no rule GAS runs is hidden. */
const toJsonRules = (schema: Schema, at: Words): QuestionRule[] =>
  Object.entries(schema)
    .filter(([key, value]) => !isShown(schema, key, value))
    .map(([key, value]) => rule(at, [code(`${key}: ${json(value)}`)]))

const notCompiled = ": GAS can't compile these questions."

const toWrongShape = (
  schema: Schema,
  key: string,
  fits: (value: unknown) => boolean,
  what: string,
  at: Words
): QuestionRule[] =>
  schema[key] === undefined || fits(schema[key])
    ? []
    : [rule(at, [code(`${key}: ${json(schema[key])}`), what, notCompiled])]

/** `properties` and `required` as GAS's strict Ajv refuses them. */
const toShapeRules = (schema: Schema, at: Words): QuestionRule[] => {
  const declared = isSchema(schema.properties) ? schema.properties : {}

  return [
    ...toWrongShape(schema, 'properties', isSchema, ' is not an object', at),
    ...toWrongShape(schema, 'required', Array.isArray, ' is not a list', at),
    ...namesIn(schema.required)
      .filter((name) => !(name in declared))
      .map((name) =>
        rule(at, [
          code(name),
          ' is required but not declared under ',
          code('properties'),
          notCompiled
        ])
      )
  ]
}

const toOneOfRules = (
  schema: Schema,
  at: Words,
  walk: Walk
): QuestionRule[] => {
  const branches =
    labelledEnumOf(schema)?.key === 'oneOf' ? null : listOf(schema.oneOf)

  return branches
    ? [
        rule(
          at,
          ['Exactly one of these must match:'],
          branches.map((branch) => toBranchSentence(branch, walk))
        )
      ]
    : []
}

const toAnyOfRules = (
  schema: Schema,
  at: Words,
  walk: Walk
): QuestionRule[] => {
  const branches =
    labelledEnumOf(schema)?.key === 'anyOf' ? null : listOf(schema.anyOf)

  return branches ? [toAnyOf(branches, at, walk)] : []
}

/** What applies at one level beyond its own fields: conditional groups, and the rest as Rules. */
const toScopeOut = (
  schema: Schema,
  at: Words,
  walk: Walk,
  tabulate = true
): ScopeOut => {
  const allOf = listOf(schema.allOf)

  return merge([
    toConditional(schema, schema, at, walk, tabulate),
    allOf ? toAllOf(allOf, schema, at, walk, tabulate) : noOut,
    {
      groups: [],
      rules: [
        ...toSumRules(schema, at),
        ...toOneOfRules(schema, at, walk),
        ...toAnyOfRules(schema, at, walk),
        ...toShapeRules(schema, at),
        ...toJsonRules(schema, at)
      ]
    }
  ])
}

/** A level's own rows, then its conditional groups. */
const toScopeRows = (schema: Schema, walk: Walk): SchemaTreeRow[] => [
  ...toPropertiesRows(schema, walk),
  ...toScopeOut(schema, [], walk).groups
]

const pathOf = (path: string | null, name: string): string =>
  path === null ? name : `${path}.${name}`

const atOf = (path: string | null): Words => [
  path === null ? '(root)' : code(path)
]

const toRules = (
  schema: Schema,
  path: string | null,
  walk: Walk
): QuestionRule[] => [
  ...toScopeOut(schema, atOf(path), walk).rules,
  ...propertiesOf(schema).flatMap(([name, property]) =>
    isSchema(property) && walk.depth < maxIndent
      ? toPropertyRules(pathOf(path, name), property, walk)
      : []
  )
]

/** An array's items have no row of their own, so their constraints are a rule. */
const toItemRules = (scope: Scope, at: string): QuestionRule[] => {
  const { schema, walk } = scope
  const constraints = toResolvedConstraints(scope)

  return [
    ...(constraints.length
      ? [rule([code(at)], ['Each item: ', ...joined(constraints, ' and ')])]
      : []),
    ...toRules(schema, at, deeper(walk))
  ]
}

/** A property's own applicators, and those of what it holds, under its path. */
const toPropertyRules = (
  at: string,
  property: Schema,
  walk: Walk
): QuestionRule[] => {
  const found = resolve(property, walk)
  const scope = scopeOf(found.schema, found.walk)

  if (scope?.suffix === '') {
    return toRules(found.schema, at, deeper(found.walk))
  }

  const own = toScopeOut(
    found.schema,
    [code(at)],
    deeper(found.walk),
    false
  ).rules

  return scope ? [...own, ...toItemRules(scope, `${at}[]`)] : own
}

/** One line for every closed object, the root among them, when there is any. */
const hasClosed = (rows: SchemaTreeRow[], root: Schema): boolean =>
  root.additionalProperties === false ||
  rows.some(
    (row) => row.kind !== 'end' && row.kind !== 'group' && row.field.closed
  )

const toSubtitle = (schema: Schema): string | null => {
  const parts = [textOf(schema.title), textOf(schema.description)].filter(
    (part) => part !== null
  )

  return parts.length ? parts.join(': ') : null
}

const toSchemaBody = (questions: Schema, usedByGas: boolean): SchemaBody => {
  const walk = { root: questions, seen: [], depth: 0 }
  const rows = toScopeRows(questions, walk)

  return {
    kind: 'schema',
    subtitle: toSubtitle(questions),
    rows,
    rules: [
      ...(usedByGas && hasClosed(rows, questions)
        ? [
            rule(
              [
                questions.additionalProperties === false
                  ? '(root) and every closed object'
                  : 'Every closed object'
              ],
              [closedRule]
            )
          ]
        : []),
      ...toRules(questions, null, walk)
    ]
  }
}

const toQuestions = (questions: unknown, usedByGas: boolean): QuestionsBody => {
  if (questions === true) {
    return { kind: 'accepts-any' }
  }

  if (questions === false) {
    return { kind: 'rejects-all' }
  }

  return isSchema(questions)
    ? toSchemaBody(questions, usedByGas)
    : { kind: 'not-a-schema' }
}

const toTitle = (phase: Schema, place: { index: number }): PhaseTitle => {
  const phaseCode = textOf(phase.code)

  return phaseCode ? { code: phaseCode, name: textOf(phase.name) } : place
}

const hasQuestions = ({ questions }: Schema): boolean =>
  questions !== undefined && questions !== null

const toPhaseCard = (
  phase: Schema,
  usedByGas: boolean,
  place: { index: number }
): GrantQuestionsCard => {
  const title = toTitle(phase, place)

  if (hasQuestions(phase)) {
    return { title, usedByGas, ...toQuestions(phase.questions, usedByGas) }
  }

  return usedByGas
    ? { title, usedByGas: true, kind: 'missing' }
    : { title, usedByGas: false, kind: 'none' }
}

const toCard = (phase: unknown, index: number): GrantQuestionsCard => {
  const usedByGas = index === 0
  const place = { index: index + 1 }

  return isSchema(phase)
    ? toPhaseCard(phase, usedByGas, place)
    : { title: place, usedByGas, kind: 'not-an-object' }
}

/** Each phase's questions as GAS reads them: only the first phase's are run on submission. */
export const toGrantQuestions = (definition: unknown): GrantQuestionsTab => {
  const phases = isSchema(definition) ? definition.phases : undefined

  if (!Array.isArray(phases) || phases.length === 0) {
    return { kind: 'no-phases' }
  }

  return { kind: 'cards', cards: phases.map(toCard) }
}
