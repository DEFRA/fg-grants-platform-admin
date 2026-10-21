import type {
  StoredComment,
  StoredInput,
  StoredLabel,
  StoredTask,
  StoredValueOption,
  StoredWorkflowPhase
} from '../use-cases/get-workflow-page.use-case.ts'

export interface AnswerComment {
  label: string
  required: boolean
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
  /** Null for an input, which asks for no comment. */
  comment: AnswerComment | null
}

export interface TaskRow {
  name: string
  mandatory: boolean
  answers: AnswerRow[]
  /** Empty when any caseworker can set the task. */
  roles: string[]
}

export interface TaskGroupCard {
  name: string
  stageName: string
  tasks: TaskRow[]
}

/** The comment the case view asks for when neither the option nor its task sets one. */
const defaultComment: StoredComment = {
  label: 'Explain this outcome',
  mandatory: true
}

const toLabel = (label: StoredLabel): string =>
  typeof label === 'string' ? label : label.text

const toComment = (comment: StoredComment): AnswerComment => ({
  label: toLabel(comment.label),
  required: comment.mandatory !== false
})

const toShownAs = ({ name, altName }: StoredValueOption): string | null =>
  altName && altName !== name ? altName : null

const toOptionRow =
  (task: StoredTask) =>
  (option: StoredValueOption): AnswerRow => ({
    name: option.name,
    shownAs: toShownAs(option),
    rules: [],
    completes: option.completes,
    comment: toComment(option.comment ?? task.comment ?? defaultComment)
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

const toInputRow = (input: StoredInput): AnswerRow => ({
  name: `${input.type[0].toUpperCase()}${input.type.slice(1)}: ${toLabel(input.label)}`,
  shownAs: null,
  rules: toRules(input),
  completes: null,
  comment: null
})

const toAnswers = (task: StoredTask): AnswerRow[] =>
  task.input
    ? [toInputRow(task.input)]
    : task.valueOptions.map(toOptionRow(task))

const toRoles = ({ requiredRoles }: StoredTask): string[] =>
  requiredRoles ? [...requiredRoles.allOf, ...requiredRoles.anyOf] : []

const toTaskRow = (task: StoredTask): TaskRow => ({
  name: task.name,
  mandatory: task.mandatory,
  answers: toAnswers(task),
  roles: toRoles(task)
})

/** Every task group of the workflow, in definition order, each with a row per answer. */
export const toTaskGroups = (phases: StoredWorkflowPhase[]): TaskGroupCard[] =>
  phases.flatMap(({ stages }) =>
    stages.flatMap(({ name: stageName, taskGroups }) =>
      taskGroups.map(({ name, tasks }) => ({
        name,
        stageName,
        tasks: tasks.map(toTaskRow)
      }))
    )
  )
