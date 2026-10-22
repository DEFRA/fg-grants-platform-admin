import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import { woodlandPhases } from '../../../use-cases/test-fixtures.ts'
import { toTaskGroups } from '../../../view-models/workflow-tasks.view-model.ts'
import type {
  AnswerRow,
  TaskGroupCard,
  TaskRow
} from '../../../view-models/workflow-tasks.view-model.ts'

const testId = 'workflow-tasks'

const renderGroups = (groups: TaskGroupCard[] = toTaskGroups(woodlandPhases)) =>
  render('workflow-tasks', { groups, testId })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const answer = (overrides: Partial<AnswerRow> = {}): AnswerRow => ({
  name: 'Accepted',
  shownAs: null,
  rules: [],
  completes: true,
  comment: { label: 'Explain this outcome', required: true },
  ...overrides
})

const oneTask = (overrides: Partial<TaskRow> = {}) =>
  renderGroups([
    {
      name: 'Checks',
      stageName: 'Review',
      tasks: [
        {
          name: 'Check',
          mandatory: true,
          answers: [answer()],
          roles: [],
          ...overrides
        }
      ]
    }
  ])

const cellsOf = ($: CheerioAPI) =>
  part($, 'answer')
    .toArray()
    .map((row) =>
      $(row)
        .children('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    )

describe('workflow-tasks component', () => {
  test('gives a card per group, titled by the group then its stage, labelling the card', () => {
    const $ = renderGroups()
    const titles = part($, 'group-title')

    expect(
      titles
        .toArray()
        .map((title) => [
          flatten($(title).text()),
          $(title).find('span').text(),
          $(title).find('span').attr('class')
        ])
    ).toEqual([
      [
        'Application checks Review application',
        'Review application',
        'font-normal text-base-content/70'
      ],
      [
        'Approval Review application',
        'Review application',
        'font-normal text-base-content/70'
      ]
    ])
    expect(
      new Set(titles.toArray().map((title) => title.attribs.id)).size
    ).toBe(2)
    part($, 'group')
      .toArray()
      .forEach((group) => {
        const labelledBy = $(group).attr('aria-labelledby')

        expect($(`#${labelledBy}`)).toHaveLength(1)
        expect($(group).find(`#${labelledBy}`)).toHaveLength(1)
      })
  })

  test('heads each table Task, Mandatory, Answer, Completes task, Comment and Roles, scrolling on a narrow screen', () => {
    const $ = renderGroups()
    const table = part($, 'group').first().find('table')

    expect(
      table
        .find('th')
        .toArray()
        .map((th) => [$(th).text(), $(th).attr('scope')])
    ).toEqual([
      ['Task', 'col'],
      ['Mandatory', 'col'],
      ['Answer', 'col'],
      ['Completes task', 'col'],
      ['Comment', 'col'],
      ['Roles', 'col']
    ])
    expect(
      table
        .find('col')
        .toArray()
        .map((col) => $(col).attr('class'))
    ).toEqual(['w-[17%]', 'w-[9%]', 'w-[20%]', 'w-[13%]', 'w-[20%]', 'w-[21%]'])
    expect(table.attr('class')).toContain('min-w-[64rem]')
    expect(table.parent().attr('class')).toBe('w-full overflow-x-auto')
  })

  test('gives a row per answer, the task, mandatory and roles spanning its answers', () => {
    const $ = renderGroups()

    expect(cellsOf($)).toEqual([
      [
        'Check eligibility',
        'Yes',
        'Accepted',
        'Yes',
        'Explain this outcome required',
        'Any caseworker'
      ],
      ['Information needed', 'No', 'What is missing required'],
      ['Cannot complete', 'No', 'Why required'],
      [
        'Check land parcels',
        'Yes',
        'Accepted',
        'Yes',
        'Explain this outcome required',
        'Any caseworker'
      ],
      ['Not accepted', 'Yes', 'Which parcels required'],
      [
        'Record site visit date',
        'No',
        'Date: Site visit date',
        'When filled in',
        '—',
        'ROLE_RPA_CASES_APPROVE'
      ],
      [
        'Second check',
        'Yes',
        'Agreed',
        'Yes',
        'Explain this outcome required',
        'ROLE_RPA_ADMIN'
      ],
      ['Not agreed', 'Yes', 'Why not required']
    ])
    expect(
      part($, 'task')
        .toArray()
        .map((cell) => $(cell).attr('rowspan'))
    ).toEqual(['3', '2', undefined, '2'])
    expect(part($, 'roles').first().attr('rowspan')).toBe('3')
  })

  test('draws a line under the last answer of each task only', () => {
    const $ = renderGroups()

    expect(
      part($, 'answer')
        .toArray()
        .map((row) => $(row).attr('class')?.includes('[&>td]:border-b-0'))
    ).toEqual([true, true, false, true, false, false, true, false])
  })

  test('mutes No, and an optional comment says so', () => {
    const $ = oneTask({
      mandatory: false,
      answers: [
        answer({
          completes: false,
          comment: { label: 'Why', required: false }
        })
      ]
    })

    expect(part($, 'mandatory').find('span').text()).toBe('No')
    expect(part($, 'mandatory').find('span').attr('class')).toBe(
      'text-base-content/60'
    )
    expect(part($, 'completes').find('span').text()).toBe('No')
    expect(flatten(part($, 'comment').text())).toBe('Why optional')
    expect(part($, 'comment').find('span').attr('class')).toBe(
      'text-base-content/60'
    )
  })

  test('says what an option is shown as, and an input its rules, under the answer', () => {
    const $ = oneTask({
      answers: [
        answer({ name: 'Zone 1', shownAs: 'Low risk' }),
        answer({
          name: 'Number: Storage',
          rules: ['0 to 5000', 'whole number'],
          completes: null,
          comment: null
        })
      ]
    })

    expect(part($, 'shown-as').text()).toBe('shown as Low risk')
    expect(part($, 'rules').text()).toBe('0 to 5000, whole number')
    expect(part($, 'shown-as').attr('class')).toBe(
      'mt-0.5 text-sm text-base-content/60'
    )
    expect(part($, 'rules').attr('class')).toBe(
      'mt-0.5 text-sm text-base-content/60'
    )
  })

  test('puts each role on its own line, in mono', () => {
    const $ = oneTask({ roles: ['ROLE_RPA_CASES_APPROVE', 'ROLE_RPA_ADMIN'] })

    expect(
      part($, 'roles')
        .children('div')
        .toArray()
        .map((role) => [$(role).text(), $(role).attr('class')])
    ).toEqual([
      ['ROLE_RPA_CASES_APPROVE', 'font-mono text-sm'],
      ['ROLE_RPA_ADMIN', 'font-mono text-sm']
    ])
  })

  test('says any caseworker can set a task that needs no roles, in plain text', () => {
    const $ = oneTask({ roles: [] })

    expect(flatten(part($, 'roles').text())).toBe('Any caseworker')
    expect(part($, 'roles').children()).toHaveLength(0)
  })

  test('shows a task with no answers as one row of dashes', () => {
    const $ = oneTask({ answers: [] })

    expect(cellsOf($)).toEqual([
      ['Check', 'Yes', '—', '—', '—', 'Any caseworker']
    ])
    expect(part($, 'task').attr('rowspan')).toBeUndefined()
  })

  test('says a workflow without task groups has none', () => {
    const $ = renderGroups([])

    expect(flatten(part($, 'empty').text())).toBe('No task groups.')
    expect($('table')).toHaveLength(0)
  })

  test('carries no codes, dots or inline styles', () => {
    const $ = renderGroups()

    expect($('[style]')).toHaveLength(0)
    expect($('.status')).toHaveLength(0)
    expect($.html()).not.toContain('CHECK_ELIGIBILITY')
  })
})
