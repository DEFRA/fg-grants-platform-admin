import { render } from '../../../test-utils.ts'
import type { WorkflowDefinition } from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowPagesTab } from '../../../view-models/workflow-pages-tab.ts'

const testId = 'workflow-pages'

const renderTab = (definition: WorkflowDefinition = woodlandDefinition) =>
  render('workflow-pages', {
    tab: toWorkflowPagesTab(definition),
    testId
  })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = (name: string, definition?: WorkflowDefinition) =>
  renderTab(definition)(`[data-testid="${testId}-${name}"]`)

const withWorkflow = (
  workflow: Partial<WorkflowDefinition['workflow']>
): WorkflowDefinition => ({
  workflow: { ...woodlandDefinition.workflow, ...workflow },
  addresses: woodlandDefinition.addresses
})

describe('workflow-pages component', () => {
  test('anchors the banner and every case tab', () => {
    const $ = renderTab()

    expect($('#banner')).toHaveLength(1)
    expect($('#tab-land-parcels')).toHaveLength(1)
    expect($('#tab-tasks')).toHaveLength(1)
  })

  test('shows the banner title path and each button by name, as plain text, with the endpoint it calls', () => {
    expect(flatten(part('title').text())).toBe('$.payload.answers.businessName')
    expect(part('title').find('span').attr('class')).toContain('font-mono')

    const $button = part('button')

    expect($button).toHaveLength(1)
    expect($button.find('a')).toHaveLength(0)
    expect($button.children('span').first().text()).toBe('Recalculate payment')
    expect($button.children('span').first().attr('class')).toBeUndefined()
    expect(flatten($button.text())).toBe(
      'Recalculate payment POST /api/v1/calculate Not configured'
    )
  })

  test('lists the summary fields with their value paths and types', () => {
    const $ = renderTab()

    expect(
      $(`[data-testid="${testId}-summary-row"]`)
        .toArray()
        .map((row) =>
          $(row)
            .find('td')
            .toArray()
            .map((cell) => $(cell).text())
        )
    ).toEqual([
      ['sbi', 'SBI', '$.payload.identifiers.sbi', 'string'],
      ['reference', 'Reference', '$.caseRef', 'string'],
      ['hectares', 'Area (ha)', '$.payload.answers.hectares', 'number'],
      ['submitted', 'Submitted', '$.payload.submittedAt', 'date (dd MMM yyyy)']
    ])
  })

  test('draws no summary table when the banner has no fields', () => {
    const definition = withWorkflow({
      pages: { cases: { details: { banner: { title: { type: 'string' } } } } }
    })

    expect(part('summary', definition)).toHaveLength(0)
    expect(flatten(part('title', definition).text())).toBe('—')
    expect(flatten(part('buttons', definition).text())).toContain(
      'Recalculate payment'
    )
  })

  test('marks no buttons with a dash', () => {
    const definition = withWorkflow({ externalActions: [] })

    expect(flatten(part('buttons', definition).text())).toBe('—')
  })

  test('lists the case tabs in order, with when each shows, what it fires and its components', () => {
    const $ = renderTab()

    expect(
      part('tab-row')
        .toArray()
        .map((row) => flatten($(row).text()))
    ).toEqual([
      '1 Tasks built in always — —',
      '2 Application built in always — summary-list',
      '3 Land always Refresh land parcels GET https://land-data.example/api/v2/parcels/{sbi} table',
      '4 Timeline built in always — —',
      '5 Notes built in always — —',
      '6 Agreement $.supplementaryData.agreements — table'
    ])
    expect(
      $('#tab-land-parcels [data-testid="workflow-pages-built-in"]')
    ).toHaveLength(0)
    expect(
      $('#tab-tasks [data-testid="workflow-pages-built-in"]')
    ).toHaveLength(1)
  })

  test('writes codes, paths and components in mono, and always and dashes muted', () => {
    const $ = renderTab()
    const $land = $('#tab-land-parcels')

    expect($land.find('td').eq(4).find('span').attr('class')).toContain(
      'font-mono'
    )
    expect(
      $land
        .find('[data-testid="workflow-pages-action"] .break-all span')
        .first()
        .attr('class')
    ).toContain('font-mono')
    expect($land.find('td').eq(2).find('span').attr('class')).toContain(
      'text-base-content/70'
    )
    expect($('#tab-tasks td').eq(3).find('span').attr('class')).toContain(
      'text-base-content/70'
    )
  })

  test('joins several components with a quiet comma', () => {
    const definition = withWorkflow({
      pages: {
        cases: {
          details: {
            tabs: { land: { content: [{ component: 'table' }, {}] } }
          }
        }
      }
    })

    expect(flatten(renderTab(definition)('#tab-land td').eq(4).text())).toBe(
      'table, text'
    )
  })

  test('warns of an action that is not defined, and of one with no endpoint', () => {
    const definition = withWorkflow({
      externalActions: [
        {
          code: 'BARE',
          name: 'Bare action',
          display: false,
          endpoint: 'nowhere',
          target: null
        }
      ],
      pages: {
        cases: {
          details: { tabs: { land: { action: { a: 'MISSING', b: 'BARE' } } } }
        }
      }
    })
    const $actions = part('action', definition)

    expect(flatten($actions.eq(0).text())).toBe('MISSING Not defined')
    expect(flatten($actions.eq(1).text())).toBe('Bare action No endpoint')
    expect(
      $actions.eq(1).find('[data-testid="do-status-dot"]').attr('class')
    ).toContain('status-warning')
  })
})
