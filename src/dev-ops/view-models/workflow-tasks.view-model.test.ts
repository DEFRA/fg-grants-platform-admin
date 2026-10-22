import type {
  StoredInput,
  StoredTask,
  StoredValueOption,
  StoredWorkflowPhase
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../use-cases/test-fixtures.ts'
import { toTaskGroups } from './workflow-tasks.view-model.ts'

const explain = { label: 'Explain this outcome', required: true }

const stage = (
  code: string,
  ...groups: [string, StoredTask[]][]
): StoredWorkflowPhase['stages'][number] => ({
  code,
  name: `Stage ${code}`,
  statuses: [],
  taskGroups: groups.map(([name, tasks]) => ({ code: 'GROUP', name, tasks }))
})

const onePhase = (
  ...stages: StoredWorkflowPhase['stages']
): StoredWorkflowPhase[] => [{ code: 'P', name: 'Phase', stages }]

type TaskFields = Partial<Omit<StoredTask, 'input' | 'valueOptions'>>

const task = (
  overrides: TaskFields & { valueOptions?: StoredValueOption[] } = {}
): StoredTask => ({
  code: 'TASK',
  name: 'Task',
  mandatory: true,
  valueOptions: [{ code: 'DONE', name: 'Done', completes: true }],
  ...overrides
})

const inputTask = (
  input: StoredInput,
  overrides: TaskFields = {}
): StoredTask => ({
  code: 'TASK',
  name: 'Task',
  mandatory: true,
  ...overrides,
  input
})

const rowsOf = (stored: StoredTask) =>
  toTaskGroups(onePhase(stage('S', ['Group', [stored]])))[0].tasks[0]

const answersOf = (stored: StoredTask) => rowsOf(stored).answers

describe('toTaskGroups', () => {
  test('gives a card per task group, in phase, stage and group order, under its stage name', () => {
    const phases: StoredWorkflowPhase[] = [
      {
        code: 'ONE',
        name: 'One',
        stages: [
          stage('A', ['First', [task()]], ['Second', [task()]]),
          stage('EMPTY')
        ]
      },
      { code: 'TWO', name: 'Two', stages: [stage('B', ['First', [task()]])] }
    ]

    expect(
      toTaskGroups(phases).map(({ name, stageName }) => [name, stageName])
    ).toEqual([
      ['First', 'Stage A'],
      ['Second', 'Stage A'],
      ['First', 'Stage B']
    ])
  })

  test('gives no cards for a workflow without task groups', () => {
    expect(toTaskGroups(onePhase(stage('S')))).toEqual([])
  })

  test('keeps tasks in order, with whether each is mandatory', () => {
    const [group] = toTaskGroups(
      onePhase(
        stage('S', [
          'Group',
          [
            task({ name: 'Must', mandatory: true }),
            task({ name: 'May', mandatory: false })
          ]
        ])
      )
    )

    expect(
      group.tasks.map(({ name, mandatory }) => ({ name, mandatory }))
    ).toEqual([
      { name: 'Must', mandatory: true },
      { name: 'May', mandatory: false }
    ])
  })

  test('gives an answer per option, in order, with whether it completes the task', () => {
    expect(
      answersOf(
        task({
          valueOptions: [
            { code: 'YES', name: 'Accepted', completes: true },
            { code: 'NO', name: 'Information needed', completes: false }
          ]
        })
      ).map(({ name, completes }) => ({ name, completes }))
    ).toEqual([
      { name: 'Accepted', completes: true },
      { name: 'Information needed', completes: false }
    ])
  })

  test("asks for the option's own comment first", () => {
    const [answer] = answersOf(
      task({
        comment: { label: 'Task note', mandatory: true },
        valueOptions: [
          {
            code: 'NO',
            name: 'No',
            completes: true,
            comment: { label: 'Why', mandatory: false }
          }
        ]
      })
    )

    expect(answer.comment).toEqual({ label: 'Why', required: false })
  })

  test("asks for the task's comment for an option without one", () => {
    const [answer] = answersOf(
      task({
        comment: { label: { text: 'Task note' }, mandatory: false },
        valueOptions: [
          { code: 'NO', name: 'No', completes: true, comment: null }
        ]
      })
    )

    expect(answer.comment).toEqual({ label: 'Task note', required: false })
  })

  test("asks for CW's required default when neither the option nor the task has a comment", () => {
    expect(answersOf(task({ comment: null }))[0].comment).toEqual(explain)
    expect(answersOf(task())[0].comment).toEqual(explain)
  })

  test('shows an option by the name the case shows once it is chosen, when that differs', () => {
    const answers = answersOf(
      task({
        valueOptions: [
          { code: 'A', name: 'Zone 1', altName: 'Low risk', completes: true },
          { code: 'B', name: 'Zone 2', altName: 'Zone 2', completes: true },
          { code: 'C', name: 'Zone 3', altName: null, completes: true }
        ]
      })
    )

    expect(answers.map(({ shownAs }) => shownAs)).toEqual([
      'Low risk',
      null,
      null
    ])
  })

  test('gives an input task one answer, named by its type and label, completed when filled in, with no comment', () => {
    expect(
      answersOf(
        inputTask(
          { type: 'date', label: 'Site visit date' },
          { comment: { label: 'Unused', mandatory: true } }
        )
      )
    ).toEqual([
      {
        name: 'Date: Site visit date',
        shownAs: null,
        rules: [],
        completes: null,
        comment: null
      }
    ])
  })

  test("reads an input's label text", () => {
    const [answer] = answersOf(
      inputTask({ type: 'text', label: { text: 'Reference', classes: 'x' } })
    )

    expect(answer.name).toBe('Text: Reference')
  })

  test("lists a number input's range and whole-number rule", () => {
    const rulesOf = (input: Omit<NonNullable<StoredTask['input']>, 'label'>) =>
      answersOf(inputTask({ ...input, label: 'Size' }))[0].rules

    expect(
      rulesOf({ type: 'number', min: 0, max: 5000, integer: true })
    ).toEqual(['0 to 5000', 'whole number'])
    expect(rulesOf({ type: 'number', min: 1 })).toEqual(['1 to …'])
    expect(rulesOf({ type: 'number', max: 9 })).toEqual(['… to 9'])
    expect(rulesOf({ type: 'number', integer: false })).toEqual([])
  })

  test("lists a text input's pattern and length", () => {
    expect(
      answersOf(
        inputTask({
          type: 'text',
          label: 'Reference',
          pattern: '[A-Z]{2}[0-9]{6}',
          maxlength: 8
        })
      )[0].rules
    ).toEqual(['pattern [A-Z]{2}[0-9]{6}', 'up to 8 characters'])
  })

  test('gives a task with no options no answers', () => {
    expect(answersOf(task({ valueOptions: [] }))).toEqual([])
  })

  test('lists the roles a task needs, all of then any of', () => {
    expect(
      rowsOf(
        task({
          requiredRoles: {
            allOf: ['ROLE_RPA_CASES_APPROVE'],
            anyOf: ['ROLE_RPA_ADMIN', 'ROLE_RPA_LAND_SPECIALIST']
          }
        })
      ).roles
    ).toEqual([
      'ROLE_RPA_CASES_APPROVE',
      'ROLE_RPA_ADMIN',
      'ROLE_RPA_LAND_SPECIALIST'
    ])
    expect(rowsOf(task({ requiredRoles: null })).roles).toEqual([])
    expect(rowsOf(task()).roles).toEqual([])
  })

  test("reads the prototype's woodland-creation 1.2.0", () => {
    const optionRow = (
      name: string,
      completes: boolean,
      comment = explain
    ) => ({
      name,
      shownAs: null,
      rules: [],
      completes,
      comment
    })
    const required = (label: string) => ({ label, required: true })

    expect(toTaskGroups(woodlandPhases)).toEqual([
      {
        name: 'Application checks',
        stageName: 'Review application',
        tasks: [
          {
            name: 'Check eligibility',
            mandatory: true,
            roles: [],
            answers: [
              optionRow('Accepted', true),
              optionRow(
                'Information needed',
                false,
                required('What is missing')
              ),
              optionRow('Cannot complete', false, required('Why'))
            ]
          },
          {
            name: 'Check land parcels',
            mandatory: true,
            roles: [],
            answers: [
              optionRow('Accepted', true),
              optionRow('Not accepted', true, required('Which parcels'))
            ]
          },
          {
            name: 'Record site visit date',
            mandatory: false,
            roles: ['ROLE_RPA_CASES_APPROVE'],
            answers: [
              {
                name: 'Date: Site visit date',
                shownAs: null,
                rules: [],
                completes: null,
                comment: null
              }
            ]
          }
        ]
      },
      {
        name: 'Approval',
        stageName: 'Review application',
        tasks: [
          {
            name: 'Second check',
            mandatory: true,
            roles: ['ROLE_RPA_ADMIN'],
            answers: [
              optionRow('Agreed', true),
              optionRow('Not agreed', true, required('Why not'))
            ]
          }
        ]
      }
    ])
  })
})
