import type {
  StoredInput,
  StoredTask,
  StoredValueOption,
  StoredWorkflowPhase
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../use-cases/test-fixtures.ts'
import { toTaskGroups } from './workflow-tasks.view-model.ts'

const explain = {
  label: 'Explain this outcome',
  required: true,
  source: 'default',
  apiRequires: false
}

type Stage = StoredWorkflowPhase['stages'][number]

const stage = (code: string, ...groups: [string, StoredTask[]][]): Stage => ({
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
  test('gives a card per task group, in phase, stage and group order, with its code and stage', () => {
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
      toTaskGroups(phases).map(({ name, code, stage }) => [name, code, stage])
    ).toEqual([
      ['First', 'GROUP', { code: 'A', name: 'Stage A' }],
      ['Second', 'GROUP', { code: 'A', name: 'Stage A' }],
      ['First', 'GROUP', { code: 'B', name: 'Stage B' }]
    ])
  })

  test("anchors a stage's first card only, so a link to the stage lands on it", () => {
    const cards = toTaskGroups(
      onePhase(
        stage('A', ['First', [task()]], ['Second', [task()]]),
        stage('B', ['Third', [task()]])
      )
    )

    expect(cards.map(({ anchor }) => anchor)).toEqual([
      'stage-A',
      null,
      'stage-B'
    ])
  })

  test("gives the stage's stored name, whatever it is", () => {
    const [card] = toTaskGroups(
      onePhase({ ...stage('REVIEW', ['Group', [task()]]), name: 'Tasks' })
    )

    expect(card.stage).toEqual({ code: 'REVIEW', name: 'Tasks' })
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

  test("asks for the option's own comment first, saying it comes from the option", () => {
    const [answer] = answersOf(
      task({
        comment: { label: 'Task note', mandatory: false },
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

    expect(answer.comment).toEqual({
      label: 'Why',
      required: false,
      source: 'option',
      apiRequires: false
    })
  })

  test("requires a comment on an optional option when CW's API holds it to the task's mandatory one", () => {
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

    expect(answer.comment).toEqual({
      label: 'Why',
      required: true,
      source: 'option',
      apiRequires: true
    })
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

    expect(answer.comment).toEqual({
      label: 'Task note',
      required: false,
      source: 'task',
      apiRequires: false
    })
  })

  test("asks for CW's required default when neither the option nor the task has a comment", () => {
    expect(answersOf(task({ comment: null }))[0].comment).toEqual(explain)
    expect(answersOf(task())[0].comment).toEqual(explain)
  })

  test('shows a comment asked the same way by every answer once, spanning them all', () => {
    const answers = answersOf(
      task({
        valueOptions: [
          { code: 'A', name: 'A', completes: true },
          { code: 'B', name: 'B', completes: false },
          { code: 'C', name: 'C', completes: false }
        ]
      })
    )

    expect(answers.map(({ commentRows }) => commentRows)).toEqual([3, 0, 0])
  })

  test('keeps a comment cell per answer when any answer asks differently', () => {
    const answers = answersOf(
      task({
        valueOptions: [
          { code: 'A', name: 'A', completes: true },
          {
            code: 'B',
            name: 'B',
            completes: false,
            comment: { label: 'Why', mandatory: true }
          }
        ]
      })
    )

    expect(answers.map(({ commentRows }) => commentRows)).toEqual([1, 1])
  })

  test('shows an option by the name the task list shows once it is chosen, when that differs', () => {
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

  test('gives an input task one answer, named by its type and label, completed when filled in', () => {
    expect(
      answersOf(inputTask({ type: 'date', label: 'Site visit date' }))
    ).toEqual([
      {
        name: 'Date: Site visit date',
        shownAs: null,
        rules: [],
        completes: null,
        comment: null,
        commentRows: 1
      }
    ])
  })

  test('holds an input task to its own comment rule, as CW does', () => {
    const [answer] = answersOf(
      inputTask(
        { type: 'text', label: 'Survey reference' },
        {
          comment: {
            label: 'Where did the reference come from?',
            mandatory: true
          }
        }
      )
    )

    expect(answer.comment).toEqual({
      label: 'Where did the reference come from?',
      required: true,
      source: 'task',
      apiRequires: true
    })
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

  test('says which roles a task needs, all of then any of', () => {
    expect(
      rowsOf(
        task({
          requiredRoles: {
            allOf: ['ROLE_QA_COMPLEX_CASEWORKER'],
            anyOf: ['ROLE_QA_COMPLEX_LEAD', 'ROLE_QA_COMPLEX_CLAIMS']
          }
        })
      ).roles
    ).toEqual([
      { label: 'all of', roles: ['ROLE_QA_COMPLEX_CASEWORKER'] },
      {
        label: 'any of',
        roles: ['ROLE_QA_COMPLEX_LEAD', 'ROLE_QA_COMPLEX_CLAIMS']
      }
    ])
    expect(
      rowsOf(task({ requiredRoles: { allOf: [], anyOf: ['ROLE_X'] } })).roles
    ).toEqual([{ label: 'any of', roles: ['ROLE_X'] }])
    expect(rowsOf(task({ requiredRoles: null })).roles).toEqual([])
    expect(rowsOf(task()).roles).toEqual([])
  })

  test('keeps the condition CW tests before it gives a case the task', () => {
    expect(
      rowsOf(task({ conditional: '$.payload.answers.hasPreviousGrant' }))
        .condition
    ).toBe('$.payload.answers.hasPreviousGrant')
    expect(
      rowsOf(
        task({
          conditional: 'jsonata:$count($.payload.answers.capitalItems) > 0'
        })
      ).condition
    ).toBe('jsonata:$count($.payload.answers.capitalItems) > 0')
    expect(rowsOf(task({ conditional: null })).condition).toBeNull()
    expect(rowsOf(task()).condition).toBeNull()
  })

  test('shows a description written as text, and counts one written as components', () => {
    expect(
      rowsOf(task({ description: 'Only a lead can complete this.' }))
        .description
    ).toEqual({ kind: 'text', text: 'Only a lead can complete this.' })
    expect(
      rowsOf(
        task({
          description: [
            { component: 'heading', text: 'Check applicant details', level: 2 },
            {
              component: 'unordered-list',
              items: [
                { component: 'text', text: 'Name matches' },
                { component: 'text', text: 'Address is ZZ99' }
              ]
            }
          ]
        })
      ).description
    ).toEqual({
      kind: 'parts',
      count: 2,
      text: 'Check applicant details Name matches Address is ZZ99'
    })
    expect(rowsOf(task({ description: null })).description).toBeNull()
    expect(rowsOf(task({ description: '' })).description).toBeNull()
    expect(rowsOf(task({ description: [] })).description).toBeNull()
  })

  test("shows a task group's description", () => {
    const [card] = toTaskGroups(
      onePhase({
        ...stage('S'),
        taskGroups: [
          {
            code: 'OFFER_CHECKS',
            name: 'Offer checks',
            description: 'Check the generated offer.',
            tasks: [task()]
          }
        ]
      })
    )

    expect(card.description).toEqual({
      kind: 'text',
      text: 'Check the generated offer.'
    })
  })
})

describe('toTaskGroups: the moves a card must be complete before', () => {
  const reviewStage: Stage = {
    ...stage('REVIEW_APPLICATION', ['Eligibility checks', [task()]]),
    statuses: [
      {
        code: 'IN_REVIEW',
        name: 'In review',
        theme: 'INFO',
        interactive: true,
        hideTaskGroups: false,
        transitions: [
          {
            targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
            checkTasks: false,
            action: {
              code: 'APPROVE',
              name: 'Approve',
              checkTasks: true,
              comment: null
            }
          },
          {
            targetPosition: 'PRE_AWARD:REVIEW_APPLICATION:ON_HOLD',
            checkTasks: false,
            action: {
              code: 'PUT_ON_HOLD',
              name: 'Put on hold',
              checkTasks: false,
              comment: null
            }
          }
        ]
      },
      {
        code: 'AGREEMENT_OFFERED',
        name: 'Agreement offered',
        theme: 'INFO',
        interactive: true,
        hideTaskGroups: false,
        transitions: [
          {
            targetPosition: 'P:REVIEW_APPLICATION:AGREEMENT_ACCEPTED',
            checkTasks: true,
            action: null
          },
          {
            targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
            checkTasks: false,
            action: {
              code: 'APPROVE',
              name: 'Approve',
              checkTasks: true,
              comment: null
            }
          }
        ]
      },
      {
        code: 'AGREEMENT_ACCEPTED',
        name: 'Agreement accepted',
        theme: 'SUCCESS',
        interactive: true,
        hideTaskGroups: false,
        transitions: []
      }
    ]
  }

  test("names each action and GAS move of the card's stage that checks tasks, once each", () => {
    const [card] = toTaskGroups(onePhase(reviewStage))

    expect(card.gates).toEqual([
      { kind: 'action', name: 'Approve', code: 'APPROVE' },
      {
        kind: 'gas',
        statusName: 'Agreement accepted',
        position: 'P:REVIEW_APPLICATION:AGREEMENT_ACCEPTED'
      }
    ])
  })

  test('leaves out an action whose own checkTasks is off, whatever its transition says, as CW does', () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        statuses: [
          {
            ...reviewStage.statuses[0],
            transitions: [
              {
                targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
                checkTasks: true,
                action: {
                  code: 'APPROVE',
                  name: 'Approve',
                  checkTasks: false,
                  comment: null
                }
              }
            ]
          }
        ]
      })
    )

    expect(card.gates).toEqual([])
  })

  test("names a GAS move's target by its position when the workflow has no such status", () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        statuses: [
          {
            ...reviewStage.statuses[0],
            transitions: [
              { targetPosition: 'X:Y:Z', checkTasks: true, action: null }
            ]
          }
        ]
      })
    )

    expect(card.gates).toEqual([
      { kind: 'gas', statusName: 'X:Y:Z', position: 'X:Y:Z' }
    ])
  })

  test('marks a card whose mandatory task is conditional, and no other', () => {
    const withConditional = (conditional: string | null, mandatory = true) =>
      toTaskGroups(
        onePhase({
          ...reviewStage,
          taskGroups: [
            {
              code: 'G',
              name: 'Checks',
              tasks: [task({ mandatory, conditional })]
            }
          ]
        })
      )[0].conditional

    expect(withConditional('$.payload.answers.hasPreviousGrant')).toBe(true)
    expect(withConditional(null)).toBe(false)
    expect(withConditional('$.x', false)).toBe(false)
  })

  test('names none on a card with no mandatory task, which holds nothing up', () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        taskGroups: [
          {
            code: 'G',
            name: 'Optional',
            tasks: [task({ mandatory: false })]
          }
        ]
      })
    )

    expect(card.gates).toEqual([])
  })
})

describe('toTaskGroups on the prototype', () => {
  test("reads the prototype's woodland-creation 1.2.0", () => {
    const cards = toTaskGroups(woodlandPhases)

    expect(
      cards.map(({ name, stage, anchor, tasks }) => ({
        name,
        stage: stage.code,
        anchor,
        tasks: tasks.map(({ name: taskName }) => taskName)
      }))
    ).toEqual([
      {
        name: 'Application checks',
        stage: 'REVIEW',
        anchor: 'stage-REVIEW',
        tasks: [
          'Check eligibility',
          'Check land parcels',
          'Record site visit date'
        ]
      },
      {
        name: 'Approval',
        stage: 'REVIEW',
        anchor: null,
        tasks: ['Second check']
      }
    ])
  })
})
