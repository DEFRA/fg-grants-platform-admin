import type { WorkflowDefinition } from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../use-cases/test-fixtures.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'

const withWorkflow = (
  workflow: Omit<WorkflowDefinition['workflow'], 'phases'>
): WorkflowDefinition => ({
  workflow: { phases: [], ...workflow },
  addresses: []
})

const integrationsHref =
  '/dev-ops/workflows/woodland-creation/1.2.0?tab=integrations&back=%2Fdev-ops%2Fworkflows'

const woodland = toWorkflowPagesTab(woodlandDefinition, integrationsHref)

describe('toWorkflowPagesTab', () => {
  test('says what CW calls for each button and each action a tab fires, linked to its Integrations card', () => {
    expect(woodland.banner.buttons).toEqual([
      expect.objectContaining({
        kind: 'call',
        action: expect.objectContaining({ code: 'RECALCULATE' }),
        href: `${integrationsHref}#action-RECALCULATE`
      })
    ])
    expect(
      woodland.tabs.find(({ key }) => key === 'land-parcels')?.fires
    ).toEqual([
      expect.objectContaining({
        kind: 'call',
        action: expect.objectContaining({ code: 'REFRESH_PARCELS' }),
        href: `${integrationsHref}#action-REFRESH_PARCELS`
      })
    ])
  })

  test('keeps each shown action when two share a code', () => {
    const [action] = woodlandDefinition.workflow.externalActions ?? []
    const twin = { ...action, name: 'Recalculate again' }

    const tab = toWorkflowPagesTab(
      {
        ...woodlandDefinition,
        workflow: {
          ...woodlandDefinition.workflow,
          externalActions: [
            { ...action, display: true },
            { ...twin, display: true }
          ]
        }
      },
      integrationsHref
    )

    expect(tab.banner.buttons).toEqual([
      expect.objectContaining({ action: { ...action, display: true } }),
      expect.objectContaining({ action: { ...twin, display: true } })
    ])
  })

  test('links an action with no endpoint, but not one that is not defined', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
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
      }),
      integrationsHref
    )

    expect(
      tab.tabs
        .find(({ key }) => key === 'land')
        ?.fires.map(({ kind, href }) => ({ kind, href }))
    ).toEqual([
      { kind: 'not-defined', href: null },
      { kind: 'no-endpoint', href: `${integrationsHref}#action-BARE` }
    ])
  })

  test('reads the banner title and summary fields in key order', () => {
    expect(woodland.banner.title).toEqual({
      kind: 'value',
      text: '$.payload.answers.businessName'
    })
    expect(woodland.banner.summary).toEqual([
      {
        key: 'sbi',
        label: 'SBI',
        valueFrom: { kind: 'value', text: '$.payload.identifiers.sbi' },
        type: 'string'
      },
      {
        key: 'reference',
        label: 'Reference',
        valueFrom: { kind: 'value', text: '$.caseRef' },
        type: 'string'
      },
      {
        key: 'hectares',
        label: 'Area (ha)',
        valueFrom: { kind: 'value', text: '$.payload.answers.hectares' },
        type: 'number'
      },
      {
        key: 'submitted',
        label: 'Submitted',
        valueFrom: { kind: 'value', text: '$.payload.submittedAt' },
        type: 'date (dd MMM yyyy)'
      }
    ])
  })

  test('tells a stored empty path from one that is not there', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
        pages: {
          cases: {
            details: {
              banner: {
                title: { text: '', type: 'string' },
                summary: { sbi: { label: 'SBI', type: 'string' } }
              }
            }
          }
        }
      }),
      integrationsHref
    )

    expect(tab.banner.title).toEqual({ kind: 'empty', text: '""' })
    expect(tab.banner.summary[0].valueFrom).toEqual({ kind: 'none' })
  })

  test('has no title, buttons or fields without a banner', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
        externalActions: woodlandDefinition.workflow.externalActions
      }),
      integrationsHref
    )

    expect(tab.banner).toEqual({
      title: { kind: 'none' },
      buttons: [],
      summary: []
    })
  })

  test('numbers the case tabs from one', () => {
    expect(
      woodland.tabs.map(({ order, label, builtIn, shownWhen, components }) => ({
        order,
        label,
        builtIn,
        shownWhen,
        components
      }))
    ).toEqual([
      {
        order: 1,
        label: 'Tasks',
        builtIn: true,
        shownWhen: null,
        components: []
      },
      {
        order: 2,
        label: 'Application',
        builtIn: true,
        shownWhen: null,
        components: ['summary-list']
      },
      {
        order: 3,
        label: 'Land',
        builtIn: false,
        shownWhen: null,
        components: ['table']
      },
      {
        order: 4,
        label: 'Timeline',
        builtIn: true,
        shownWhen: null,
        components: []
      },
      {
        order: 5,
        label: 'Notes',
        builtIn: true,
        shownWhen: null,
        components: []
      },
      {
        order: 6,
        label: 'Agreement',
        builtIn: false,
        shownWhen: '$.supplementaryData.agreements',
        components: ['table']
      }
    ])
  })
})
