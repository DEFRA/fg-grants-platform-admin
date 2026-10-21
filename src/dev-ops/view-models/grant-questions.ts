type Schema = Record<string, unknown>

export interface SchemaField {
  /** With `[]` after an array's name. */
  name: string
  title: string | null
  required: boolean
  type: string
  constraints: string[]
  /** JSON text. */
  defaultValue: string | null
  indent: number
}

export type SchemaTreeRow =
  | { kind: 'open'; field: SchemaField }
  | { kind: 'field'; field: SchemaField }
  | { kind: 'end' }

export interface QuestionRule {
  appliesTo: string
  text: string
}

/** The phase's code, or its 1-based place when it has no usable code. */
export type PhaseTitle = { code: string } | { index: number }

type QuestionsBody =
  | { kind: 'schema'; rows: SchemaTreeRow[]; rules: QuestionRule[] }
  | { kind: 'accepts-any' | 'rejects-all' | 'not-a-schema' }

export type GrantQuestionsCard =
  | ({ title: PhaseTitle; usedByGas: boolean; noCode: boolean } & QuestionsBody)
  | { title: PhaseTitle; usedByGas: true; noCode: boolean; kind: 'missing' }
  | { title: { index: number }; usedByGas: boolean; kind: 'not-an-object' }

export type GrantQuestionsTab =
  | { kind: 'cards'; cards: GrantQuestionsCard[] }
  | { kind: 'no-phases' }

const constraintKeys = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'enum',
  'const'
]

const sumRules = {
  fgSumEquals: { compare: 'equals', against: 'targetField' },
  fgSumMin: { compare: '≥', against: 'minimum' },
  fgSumMax: { compare: '≤', against: 'targetField' }
}

/** Every other keyword that applies a schema at this level: shown as JSON, so no rule GAS runs is hidden. */
const applicatorKeys = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'patternProperties',
  'prefixItems',
  '$ref',
  'propertyNames'
])

/** The indent classes stop here; deeper rows still nest. */
const maxIndent = 8

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (value: unknown): string => JSON.stringify(value)

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : json(value)

const toOneOf = (values: unknown[]): string =>
  `one of ${values.map(asText).join(', ')}`

const namesIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText) : []

const propertiesOf = (schema: Schema): [string, unknown][] =>
  isSchema(schema.properties) ? Object.entries(schema.properties) : []

const typeName = (type: unknown): string => {
  if (typeof type === 'string') {
    return type
  }

  return Array.isArray(type) ? type.map(asText).join(' or ') : 'any'
}

const itemType = (items: unknown): string =>
  isSchema(items) ? typeName(items.type) : 'any'

const toSchemaType = (property: Schema): string => {
  if (property.type === 'array') {
    return `array of ${itemType(property.items)}`
  }

  return typeof property.format === 'string'
    ? `${typeName(property.type)} (${property.format})`
    : typeName(property.type)
}

const toFieldType = (property: unknown): string => {
  if (typeof property === 'boolean') {
    return property ? 'any' : 'not allowed'
  }

  return isSchema(property) ? toSchemaType(property) : 'not a schema'
}

const toConstraint = (key: string, value: unknown): string => {
  if (key === 'enum') {
    return Array.isArray(value) ? toOneOf(value) : `enum ${json(value)}`
  }

  return key === 'const' ? `= ${json(value)}` : `${key} ${asText(value)}`
}

const toConstraints = (property: Schema): string[] =>
  constraintKeys
    .filter((key) => property[key] !== undefined)
    .map((key) => toConstraint(key, property[key]))

const itemsWithProperties = (items: unknown): Schema | null =>
  isSchema(items) && isSchema(items.properties) ? items : null

const defaultOf = (property: Schema): string | null =>
  property.default === undefined ? null : json(property.default)

/** The schema the property's children sit in: its own, or its array's items. */
const childrenOf = (property: Schema): Schema | null => {
  if (property.type === 'array') {
    return itemsWithProperties(property.items)
  }

  return isSchema(property.properties) ? property : null
}

const toField = (
  name: string,
  property: unknown,
  parent: Schema,
  depth: number
): SchemaField => {
  const schema = isSchema(property) ? property : {}

  return {
    name: schema.type === 'array' ? `${name}[]` : name,
    title: typeof schema.title === 'string' ? schema.title : null,
    required: namesIn(parent.required).includes(name),
    type: toFieldType(property),
    constraints: toConstraints(schema),
    defaultValue: defaultOf(schema),
    indent: Math.min(depth, maxIndent)
  }
}

const toRows = (schema: Schema, depth = 0): SchemaTreeRow[] =>
  propertiesOf(schema).flatMap(([name, property]): SchemaTreeRow[] => {
    const field = toField(name, property, schema, depth)
    const children = isSchema(property) ? childrenOf(property) : null

    return children
      ? [
          { kind: 'open', field },
          ...toRows(children, depth + 1),
          { kind: 'end' }
        ]
      : [{ kind: 'field', field }]
  })

const toValueCondition = (property: Schema): string | null => {
  if (property.const !== undefined) {
    return `= ${json(property.const)}`
  }

  return Array.isArray(property.enum) ? toOneOf(property.enum) : null
}

const toConditionPart = (name: string, property: unknown): string => {
  if (property === false) {
    return `${name} is absent`
  }

  const words = isSchema(property) ? toValueCondition(property) : null

  return words ? `${name} ${words}` : `${name}: ${json(property)}`
}

/** As Ajv reads `if`: a required name with a part of its own folds into it. */
const toCondition = (condition: unknown): string => {
  if (!isSchema(condition)) {
    return json(condition)
  }

  const properties = propertiesOf(condition)
  const named = new Set(properties.map(([name]) => name))
  const others = Object.entries(condition).filter(
    ([key]) => key !== 'properties' && key !== 'required'
  )

  return [
    ...properties.map(([name, property]) => toConditionPart(name, property)),
    ...namesIn(condition.required)
      .filter((name) => !named.has(name))
      .map((name) => `${name} is present`),
    ...others.map(([key, value]) => `${key}: ${json(value)}`)
  ].join(' and ')
}

const toConsequencePart = ([key, value]: [string, unknown]): string[] => {
  if (key === 'required') {
    return [`requires ${namesIn(value).join(', ')}`]
  }

  if (key === 'properties' && isSchema(value)) {
    return Object.entries(value).map(([name, property]) =>
      property === false ? `${name} not allowed` : `${name}: ${json(property)}`
    )
  }

  return [`${key}: ${json(value)}`]
}

const toConsequence = (clause: unknown): string => {
  const parts = isSchema(clause)
    ? Object.entries(clause).flatMap(toConsequencePart)
    : []

  return parts.length ? parts.join('; ') : json(clause)
}

const toOtherwise = (otherwise: unknown): string =>
  otherwise === undefined ? '' : `. Otherwise: ${toConsequence(otherwise)}`

/** Ajv applies `else` whenever `if` fails, with or without `then`; a lone `if` does nothing. */
const toConditionalRule = (schema: Schema): string | null => {
  const { if: condition, then, else: otherwise } = schema

  if (condition === undefined) {
    return null
  }

  const when = toCondition(condition)

  if (then === undefined) {
    return otherwise === undefined
      ? null
      : `Unless ${when}: ${toConsequence(otherwise)}`
  }

  return `If ${when}: ${toConsequence(then)}${toOtherwise(otherwise)}`
}

const toSumRule = (key: keyof typeof sumRules, sum: unknown): string => {
  const { compare, against } = sumRules[key]

  return isSchema(sum) && Array.isArray(sum.fields)
    ? `${key}: sum of ${namesIn(sum.fields).join(', ')} ${compare} ${asText(sum[against])}`
    : `${key}: ${json(sum)}`
}

const isApplicator = (key: string, value: unknown): boolean =>
  applicatorKeys.has(key) || (key === 'additionalProperties' && isSchema(value))

const toOwnRules = (schema: Schema): string[] => {
  const conditional = toConditionalRule(schema)

  return [
    ...(schema.additionalProperties === false
      ? ['Undeclared fields are removed on submission']
      : []),
    ...(conditional ? [conditional] : []),
    ...Object.keys(sumRules)
      .filter((key) => schema[key] !== undefined)
      .map((key) => toSumRule(key as keyof typeof sumRules, schema[key])),
    ...Object.entries(schema)
      .filter(([key, value]) => isApplicator(key, value))
      .map(([key, value]) => `${key}: ${json(value)}`)
  ]
}

/** The schema walked for the property's own rules: an object, or an array's items. */
const ruleScopeOf = (property: Schema): Schema | null =>
  property.type === 'object' ? property : childrenOf(property)

const pathOf = (path: string | null, name: string): string =>
  path === null ? name : `${path}.${name}`

const toDefaultRules = (at: string, property: Schema): QuestionRule[] => {
  const value = defaultOf(property)

  return value === null
    ? []
    : [{ appliesTo: at, text: `Default ${value} filled in when missing` }]
}

const toRules = (
  schema: Schema,
  path: string | null = null
): QuestionRule[] => [
  ...toOwnRules(schema).map((text) => ({ appliesTo: path ?? '(root)', text })),
  ...propertiesOf(schema).flatMap(([name, property]) =>
    isSchema(property) ? toPropertyRules(pathOf(path, name), property) : []
  )
]

const toNestedRules = (at: string, property: Schema): QuestionRule[] => {
  const scope = ruleScopeOf(property)

  return scope ? toRules(scope, property.type === 'array' ? `${at}[]` : at) : []
}

const toPropertyRules = (at: string, property: Schema): QuestionRule[] => [
  ...toDefaultRules(at, property),
  ...toNestedRules(at, property)
]

const toQuestions = (questions: unknown): QuestionsBody => {
  if (questions === true) {
    return { kind: 'accepts-any' }
  }

  if (questions === false) {
    return { kind: 'rejects-all' }
  }

  return isSchema(questions)
    ? { kind: 'schema', rows: toRows(questions), rules: toRules(questions) }
    : { kind: 'not-a-schema' }
}

const toTitle = (code: unknown, place: { index: number }): PhaseTitle =>
  typeof code === 'string' && code !== '' ? { code } : place

const hasQuestions = ({ questions }: Schema): boolean =>
  questions !== undefined && questions !== null

const toPhaseCard = (
  phase: Schema,
  usedByGas: boolean,
  place: { index: number }
): GrantQuestionsCard | null => {
  const title = toTitle(phase.code, place)
  const noCode = title === place

  if (hasQuestions(phase)) {
    return { title, usedByGas, noCode, ...toQuestions(phase.questions) }
  }

  return usedByGas ? { title, usedByGas: true, noCode, kind: 'missing' } : null
}

const toCard = (phase: unknown, index: number): GrantQuestionsCard | null => {
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

  return {
    kind: 'cards',
    cards: phases.flatMap((phase: unknown, index) => toCard(phase, index) ?? [])
  }
}
