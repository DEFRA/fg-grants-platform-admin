import type {
  StoredComment,
  StoredDescription,
  StoredInput,
  StoredLabel,
  StoredTask,
  StoredTransition,
  StoredValueOption,
  StoredWorkflowPhase,
  StoredWorkflowStage
} from '../use-cases/get-workflow-page.use-case.ts'
import { checksTasks } from './workflow-transitions.ts'

/** Where a comment rule comes from: CW's API enforces only the task's own, so an option's or the default is a frontend check. */
type CommentSource = 'option' | 'task' | 'default'

export interface AnswerComment {
  label: string
  required: boolean
  source: CommentSource
  /** The task's comment is mandatory, which CW's API holds every answer to. */
  apiRequires: boolean
}

/** An option a caseworker can choose, or the task's input. */
export interface AnswerRow {
  name: string
  /** The task's status in the task list once chosen, when it differs from `name`. */
  shownAs: string | null
  /** What CW checks of an input's value. */
  rules: string[]
  /** Null for an input, which completes the task once filled in. */
  completes: boolean | null
  comment: AnswerComment | null
  /** How many answer rows the comment cell spans: 0 when an earlier row's cell covers it. */
  commentRows: number
}

/** A string is shown; components are only counted, with their text in a title. */
export type Description =
  | { kind: 'text'; text: string }
  | { kind: 'parts'; count: number; text: string }

export interface RoleLine {
  label: 'all of' | 'any of'
  roles: string[]
}

export interface TaskRow {
  code: string
  name: string
  description: Description | null
  mandatory: boolean
  /** Whether CW gives a case the task at all, tested when the case enters the stage. */
  condition: string | null
  answers: AnswerRow[]
  /** Empty when any caseworker can set the task. */
  roles: RoleLine[]
}

/** A move CW refuses while a mandatory task in the stage is open. */
export type Gate =
  | { kind: 'action'; name: string; code: string }
  | { kind: 'gas'; statusName: string; position: string }

export interface TaskGroupCard {
  /** On a stage's first card only, so a link to the stage lands on it. */
  anchor: string | null
  code: string
  name: string
  stage: { code: string; name: string }
  description: Description | null
  /** Empty when the card has no mandatory task, or its stage no move that checks tasks. */
  gates: Gate[]
  /** A mandatory task here is conditional, so the gates hold only on cases it applies to. */
  conditional: boolean
  tasks: TaskRow[]
}

/** The comment the case view asks for when neither the option nor its task sets one. */
const defaultComment: StoredComment = {
  label: 'Explain this outcome',
  mandatory: true
}

const toLabel = (label: StoredLabel): string =>
  typeof label === 'string' ? label : label.text

const apiRequiresComment = ({ comment }: StoredTask): boolean =>
  comment?.mandatory === true

const toComment = (
  comment: StoredComment,
  source: CommentSource,
  task: StoredTask
): AnswerComment => ({
  label: toLabel(comment.label),
  required: comment.mandatory || apiRequiresComment(task),
  source,
  apiRequires: apiRequiresComment(task)
})

const toOptionComment = (
  option: StoredValueOption,
  task: StoredTask
): AnswerComment => {
  if (option.comment) {
    return toComment(option.comment, 'option', task)
  }

  return task.comment
    ? toComment(task.comment, 'task', task)
    : toComment(defaultComment, 'default', task)
}

const toShownAs = ({ name, altName }: StoredValueOption): string | null =>
  altName && altName !== name ? altName : null

const toOptionRow =
  (task: StoredTask) =>
  (option: StoredValueOption): AnswerRow => ({
    name: option.name,
    shownAs: toShownAs(option),
    rules: [],
    completes: option.completes,
    comment: toOptionComment(option, task),
    commentRows: 1
  })

const toBound = (bound: number | undefined): string =>
  bound === undefined ? '…' : String(bound)

const toRange = ({ min, max }: StoredInput): string | null =>
  min === undefined && max === undefined
    ? null
    : `${toBound(min)} to ${toBound(max)}`

const toTextRules = ({
  pattern,
  maxlength
}: StoredInput): (string | null)[] => [
  pattern ? `pattern ${pattern}` : null,
  maxlength ? `up to ${maxlength} characters` : null
]

const toRules = (input: StoredInput): string[] =>
  [
    toRange(input),
    input.integer ? 'whole number' : null,
    ...toTextRules(input)
  ].filter((rule) => rule !== null)

/** CW holds an input to its task's comment rule too. */
const toInputRow = (input: StoredInput, task: StoredTask): AnswerRow => ({
  name: `${input.type[0].toUpperCase()}${input.type.slice(1)}: ${toLabel(input.label)}`,
  shownAs: null,
  rules: toRules(input),
  completes: null,
  comment: task.comment ? toComment(task.comment, 'task', task) : null,
  commentRows: 1
})

const sameComment = (a: AnswerComment | null, b: AnswerComment | null) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Every answer asking for the same comment shows it once, spanning them all. */
const withCollapsedComments = (answers: AnswerRow[]): AnswerRow[] =>
  answers.length > 1 &&
  answers.every(({ comment }) => sameComment(comment, answers[0].comment))
    ? answers.map((answer, index) => ({
        ...answer,
        commentRows: index === 0 ? answers.length : 0
      }))
    : answers

const toAnswers = (task: StoredTask): AnswerRow[] =>
  task.input
    ? [toInputRow(task.input, task)]
    : withCollapsedComments(task.valueOptions.map(toOptionRow(task)))

const noRoles = { allOf: [], anyOf: [] }

const toRoles = ({ requiredRoles }: StoredTask): RoleLine[] => {
  const { allOf, anyOf } = requiredRoles ?? noRoles
  const lines: RoleLine[] = [
    { label: 'all of', roles: allOf },
    { label: 'any of', roles: anyOf }
  ]

  return lines.filter(({ roles }) => roles.length > 0)
}

const isTextOf = ([key, child]: [string, unknown]): boolean =>
  key === 'text' || typeof child === 'object'

/** Every `text` in a description's components, nested lists included, in order. */
const textsOf = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value]
  }

  return value && typeof value === 'object'
    ? Object.entries(value)
        .filter(isTextOf)
        .flatMap(([, child]) => textsOf(child))
    : []
}

const toParts = (parts: Record<string, unknown>[]): Description | null =>
  parts.length
    ? { kind: 'parts', count: parts.length, text: textsOf(parts).join(' ') }
    : null

export const toDescription = (
  description: StoredDescription | null | undefined
): Description | null => {
  if (typeof description === 'string') {
    return description ? { kind: 'text', text: description } : null
  }

  return description ? toParts(description) : null
}

const toTaskRow = (task: StoredTask): TaskRow => ({
  code: task.code,
  name: task.name,
  description: toDescription(task.description),
  mandatory: task.mandatory,
  condition: task.conditional || null,
  answers: toAnswers(task),
  roles: toRoles(task)
})

type StatusNames = Map<string, string>

const toStatusNames = (phases: StoredWorkflowPhase[]): StatusNames =>
  new Map(
    phases.flatMap(({ code: phase, stages }) =>
      stages.flatMap(({ code: stage, statuses }) =>
        statuses.map(({ code, name }): [string, string] => [
          `${phase}:${stage}:${code}`,
          name
        ])
      )
    )
  )

const toGate =
  (names: StatusNames) =>
  ({ action, targetPosition }: StoredTransition): Gate =>
    action
      ? { kind: 'action', name: action.name, code: action.code }
      : {
          kind: 'gas',
          statusName: names.get(targetPosition) ?? targetPosition,
          position: targetPosition
        }

const gateKey = (gate: Gate): string =>
  gate.kind === 'action' ? `action:${gate.code}` : `gas:${gate.position}`

/** The stage's moves that CW refuses while its mandatory tasks are open, each once. */
const toStageGates = (
  { statuses }: StoredWorkflowStage,
  names: StatusNames
): Gate[] => {
  const gates = statuses
    .flatMap(({ transitions }) => transitions)
    .filter(checksTasks)
    .map(toGate(names))

  return [...new Map(gates.map((gate) => [gateKey(gate), gate])).values()]
}

const toCards = (
  stage: StoredWorkflowStage,
  names: StatusNames
): TaskGroupCard[] => {
  const gates = toStageGates(stage, names)

  return stage.taskGroups.map(({ code, name, description, tasks }, index) => ({
    anchor: index === 0 ? `stage-${stage.code}` : null,
    code,
    name,
    stage: { code: stage.code, name: stage.name },
    description: toDescription(description),
    gates: tasks.some(({ mandatory }) => mandatory) ? gates : [],
    conditional: tasks.some(
      ({ mandatory, conditional }) => mandatory && Boolean(conditional)
    ),
    tasks: tasks.map(toTaskRow)
  }))
}

/** Every task group of the workflow, in definition order, each with a row per answer. */
export const toTaskGroups = (
  phases: StoredWorkflowPhase[]
): TaskGroupCard[] => {
  const names = toStatusNames(phases)

  return phases.flatMap(({ stages }) =>
    stages.flatMap((stage) => toCards(stage, names))
  )
}
