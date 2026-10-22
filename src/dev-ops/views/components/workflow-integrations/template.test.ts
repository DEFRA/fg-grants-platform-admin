import { load } from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'

import { render } from '../../../test-utils.ts'
import type { WorkflowDefinition } from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowIntegrations } from '../../../view-models/workflow-integrations.ts'

const testId = 'workflow-integrations'
const pagesHref =
  '/dev-ops/workflows/woodland-creation/1.2.0?tab=pages&back=%2Fdev-ops%2Fworkflows'

const renderTab = (definition: WorkflowDefinition = woodlandDefinition) =>
  render('workflow-integrations', {
    integrations: toWorkflowIntegrations(definition, pagesHref),
    testId
  })

const withWorkflow = (
  workflow: Partial<WorkflowDefinition['workflow']>
): WorkflowDefinition => ({
  workflow: { ...woodlandDefinition.workflow, ...workflow },
  addresses: woodlandDefinition.addresses
})

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const words = ($element: Cheerio<AnyNode>) =>
  flatten(load(($element.html() ?? '').replaceAll('<', ' <')).text())

const stepTexts = ($: ReturnType<typeof renderTab>, card: number) =>
  ['trigger', 'call', 'sends', 'writes'].map((step) =>
    words(
      $(`[data-testid="${testId}"]`)
        .eq(card)
        .find(`[data-testid="${testId}-${step}"]`)
    )
  )

describe('workflow-integrations component', () => {
  test('shows one card per external action, anchored by its code, titled by code then name', () => {
    const $ = renderTab()
    const $cards = $(`[data-testid="${testId}"]`)

    expect($cards.toArray().map((card) => $(card).attr('id'))).toEqual([
      'action-RECALCULATE',
      'action-REFRESH_PARCELS'
    ])
    expect($cards.eq(0).attr('class')).toContain('scroll-mt-4')
    expect($cards.eq(0).find('h2 span').eq(0).text()).toBe('RECALCULATE')
    expect($cards.eq(0).find('h2 span').eq(0).attr('class')).toBe('font-mono')
    expect($cards.eq(0).find('h2 span').eq(1).text()).toBe(
      'Recalculate payment'
    )
    expect($cards.eq(0).find('h2 span').eq(1).attr('class')).toBe(
      'font-normal text-base-content/70'
    )
    expect($cards.eq(0).find('p').text()).toBe(
      'Ask the land service for a new payment figure.'
    )
    expect($cards.eq(1).find('p')).toHaveLength(0)
  })

  test('reads each action from its trigger, through its call and what it sends, to what it writes', () => {
    const $ = renderTab()

    expect(stepTexts($, 0)).toEqual([
      'Trigger Banner button',
      'Calls POST Not configured PAYMENT_CALC recalculate',
      'Sends —',
      'Writes supplementaryData.payment object · append Timeline event'
    ])
    expect(stepTexts($, 1)).toEqual([
      'Trigger Tab: Land',
      'Calls GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA land-parcels',
      'Sends PATH sbi ← $.payload.identifiers.sbi',
      'Writes actionData.parcels'
    ])
  })

  test('links each trigger back to the Pages tab', () => {
    const $ = renderTab()

    expect(
      $(`[data-testid="${testId}-trigger"] a`)
        .toArray()
        .map((link) => [$(link).text(), $(link).attr('href')])
    ).toEqual([
      ['Banner button', `${pagesHref}#banner`],
      ['Tab: Land', `${pagesHref}#tab-land-parcels`]
    ])
  })

  test('writes codes, methods, addresses, parameters and paths in mono', () => {
    const $ = renderTab()
    const $parcels = $('#action-REFRESH_PARCELS')

    expect(
      $parcels.find(`[data-testid="${testId}-call"] span`).first().attr('class')
    ).toContain('font-mono')
    expect(
      $parcels.find(`[data-testid="${testId}-call-url"]`).attr('class')
    ).toContain('font-mono')
    expect(
      $parcels.find(`[data-testid="${testId}-endpoint"]`).attr('class')
    ).toBe('mt-1 font-mono text-xs text-base-content/60')
    expect(
      $parcels
        .find(`[data-testid="${testId}-sends"] span`)
        .toArray()
        .map((span) => $(span).attr('class'))
    ).toEqual([
      'font-mono text-xs text-base-content/60',
      'font-mono',
      'text-base-content/40',
      'font-mono'
    ])
    expect(
      $parcels.find(`[data-testid="${testId}-writes"] span`).attr('class')
    ).toContain('font-mono')
  })

  test('shows an empty expression as two quotes', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          {
            code: 'A',
            name: 'A',
            display: true,
            endpoint: {
              code: 'recalculate',
              endpointParams: { BODY: { x: '' } }
            },
            target: null
          }
        ]
      })
    )

    expect(flatten($(`[data-testid="${testId}-sends"]`).text())).toBe(
      'Sends BODY x ← ""'
    )
  })

  test('warns only of real problems, joined on one line', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          {
            code: 'LOST',
            name: 'Lost',
            display: false,
            endpoint: { code: 'nope' },
            target: null
          },
          ...(woodlandDefinition.workflow.externalActions ?? [])
        ]
      })
    )
    const $problems = $(`[data-testid="${testId}-problems"]`)

    expect($problems).toHaveLength(1)
    expect($problems.attr('class')).toBe(
      'alert alert-warning alert-soft text-sm'
    )
    expect(flatten($problems.text())).toBe(
      'Endpoint nope not defined · Not triggered: no button, no tab'
    )
    expect(flatten($('#action-LOST [data-testid$="-call"]').text())).toBe(
      'Calls —'
    )
  })

  test('gives no anchor to a later action with a used code', () => {
    const [first] = woodlandDefinition.workflow.externalActions ?? []
    const $ = renderTab(
      withWorkflow({ externalActions: [first, { ...first }] })
    )

    expect($('[id="action-RECALCULATE"]')).toHaveLength(1)
    expect($(`[data-testid="${testId}"]`).eq(1).attr('id')).toBeUndefined()
  })

  test('stacks the steps at phone width, with the arrows only from lg up', () => {
    const $ = renderTab()

    expect($(`[data-testid="${testId}-steps"]`).first().attr('class')).toBe(
      'flex flex-col gap-2 lg:flex-row lg:items-stretch'
    )
    expect(
      $(`[data-testid="${testId}-arrow"]`).first().attr('class')
    ).toContain('hidden')
    expect(
      $(`[data-testid="${testId}-arrow"]`).first().attr('class')
    ).toContain('lg:block')
    expect($(`[data-testid="${testId}"]`).eq(0).find('svg')).toHaveLength(3)
  })

  test('lists the endpoints used by nothing last, only when there are some', () => {
    expect(renderTab()(`[data-testid="${testId}-unused"]`)).toHaveLength(0)

    const $ = renderTab(
      withWorkflow({
        externalActions: woodlandDefinition.workflow.externalActions?.slice(
          0,
          1
        )
      })
    )
    const $unused = $(`[data-testid="${testId}-unused"]`)

    expect($unused.find('h2').text()).toBe('Endpoints used by nothing')
    expect(
      $unused
        .find('thead th')
        .toArray()
        .map((th) => $(th).text())
    ).toEqual(['Code', 'Method', 'URL'])
    expect(
      $unused
        .find('tbody td')
        .toArray()
        .map((td) => words($(td)))
    ).toEqual([
      'land-parcels',
      'GET',
      'https://land-data.example/api/v2/parcels/{sbi} LAND_DATA'
    ])
    expect($unused.prevAll(`[data-testid="${testId}"]`)).toHaveLength(1)
  })

  test('says there are no external actions, then lists every endpoint as used by nothing', () => {
    const $ = renderTab(withWorkflow({ externalActions: [] }))

    expect(flatten($(`[data-testid="${testId}-empty"]`).text())).toBe(
      'No external actions.'
    )
    expect($(`[data-testid="${testId}-unused"] tbody tr`)).toHaveLength(2)
  })

  test('says only that there are no external actions when there are no endpoints either', () => {
    const $ = renderTab({ workflow: { phases: [] }, addresses: [] })

    expect($(`[data-testid="${testId}-empty"]`)).toHaveLength(1)
    expect($(`[data-testid="${testId}-unused"]`)).toHaveLength(0)
  })

  test('never shows a header parameter', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          {
            code: 'A',
            name: 'A',
            display: true,
            endpoint: {
              code: 'recalculate',
              endpointParams: { HEADERS: { 'x-api-key': '$.secret' } }
            },
            target: null
          }
        ]
      })
    )

    expect($.html()).not.toContain('x-api-key')
    expect($.html()).not.toContain('HEADERS')
  })
})
