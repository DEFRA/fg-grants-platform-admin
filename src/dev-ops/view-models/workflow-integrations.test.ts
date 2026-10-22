import type {
  StoredCaseTab,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../use-cases/test-fixtures.ts'
import { toWorkflowIntegrations } from './workflow-integrations.ts'

// The tab never reads phases, so a fixture may leave them out.
type AnyWorkflow = Omit<StoredWorkflow, 'phases'> &
  Partial<Pick<StoredWorkflow, 'phases'>>

const pagesHref =
  '/dev-ops/workflows/woodland-creation/1.2.0?tab=pages&back=%2Fdev-ops%2Fworkflows'

const action = (
  code: string,
  overrides: Partial<StoredExternalAction> = {}
): StoredExternalAction => ({
  code,
  name: `Action ${code}`,
  display: false,
  endpoint: { code: 'parcels' },
  target: null,
  ...overrides
})

const endpoint = (
  code: string,
  overrides: Partial<StoredEndpoint> = {}
): StoredEndpoint => ({
  code,
  service: 'LAND_DATA',
  path: '/parcels',
  method: 'GET',
  ...overrides
})

const parcels = endpoint('parcels')

const withBanner = (tabs: Record<string, StoredCaseTab> = {}) => ({
  cases: { details: { banner: {}, tabs } }
})

const definitionOf = (
  workflow: AnyWorkflow,
  urls: (string | null)[] = []
): WorkflowDefinition => ({
  workflow: { phases: [], ...workflow },
  addresses: (workflow.endpoints ?? []).map(({ code, service }, index) => ({
    code,
    service,
    url: urls[index] ?? null
  }))
})

const integrationsOf = (workflow: AnyWorkflow, urls: (string | null)[] = []) =>
  toWorkflowIntegrations(definitionOf(workflow, urls), pagesHref)

const cardOf = (workflow: AnyWorkflow, index = 0) =>
  integrationsOf(workflow).cards[index]

describe('toWorkflowIntegrations', () => {
  test("shows the prototype's two actions, each from its trigger to what it writes", () => {
    expect(toWorkflowIntegrations(woodlandDefinition, pagesHref)).toEqual({
      cards: [
        {
          code: 'RECALCULATE',
          name: 'Recalculate payment',
          description: 'Ask the land service for a new payment figure.',
          anchor: 'action-RECALCULATE',
          problems: [],
          triggers: [{ label: 'Banner button', href: `${pagesHref}#banner` }],
          call: {
            method: 'POST',
            endpointCode: 'recalculate',
            address: { code: 'recalculate', service: 'PAYMENT_CALC', url: null }
          },
          sends: [],
          writes: [
            {
              kind: 'supplementary',
              path: 'supplementaryData.payment',
              detail: 'object · append'
            },
            { kind: 'timeline' }
          ]
        },
        {
          code: 'REFRESH_PARCELS',
          name: 'Refresh land parcels',
          description: null,
          anchor: 'action-REFRESH_PARCELS',
          problems: [],
          triggers: [
            { label: 'Tab: Land', href: `${pagesHref}#tab-land-parcels` }
          ],
          call: {
            method: 'GET',
            endpointCode: 'land-parcels',
            address: {
              code: 'land-parcels',
              service: 'LAND_DATA',
              url: 'https://land-data.example/api/v2/parcels/{sbi}'
            }
          },
          sends: [
            {
              kind: 'PATH',
              name: 'sbi',
              expression: '$.payload.identifiers.sbi'
            }
          ],
          writes: [{ kind: 'actionData', path: 'actionData.parcels' }]
        }
      ],
      unusedEndpoints: []
    })
  })
})

describe('toWorkflowIntegrations warns', () => {
  test('of an endpoint given as a string, which CW cannot call', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { endpoint: 'parcels' })],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(card.problems).toEqual(['Endpoint — not defined'])
    expect(card.call).toBeNull()
  })

  test('of an endpoint code no endpoint has', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { endpoint: { code: 'nope' } })],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(card.problems).toEqual(['Endpoint nope not defined'])
    expect(card.call).toBeNull()
  })

  test('of an action nothing triggers, after its endpoint', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A', { endpoint: { code: 'nope' } })]
      }).problems
    ).toEqual(['Endpoint nope not defined', 'Not triggered: no button, no tab'])
  })
})

describe('toWorkflowIntegrations triggers', () => {
  test('a shown action is a banner button only when the case page has a banner', () => {
    const shown = action('A', { display: true })

    expect(
      cardOf({ endpoints: [parcels], externalActions: [shown] }).triggers
    ).toEqual([])
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [shown],
        pages: withBanner()
      }).triggers
    ).toEqual([{ label: 'Banner button', href: `${pagesHref}#banner` }])
  })

  test('a display that is not true is not a banner button', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', { display: 'true' as unknown as boolean })
        ],
        pages: withBanner()
      }).triggers
    ).toEqual([])
  })

  test.each(['tasks', 'notes', 'timeline'])(
    'an action map on the built-in %s tab never fires',
    (key) => {
      expect(
        cardOf({
          endpoints: [parcels],
          externalActions: [action('A')],
          pages: withBanner({ [key]: { action: { a: 'A' } } })
        }).triggers
      ).toEqual([])
    }
  )

  test('an action map on Application fires, labelled as CW labels the tab', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({ 'case-details': { action: { a: 'A' } } })
      }).triggers
    ).toEqual([
      { label: 'Tab: Application', href: `${pagesHref}#tab-case-details` }
    ])
  })

  test('a tab with no link text is labelled by its key, title-cased', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({ 'land-parcels': { action: { a: 'A' } } })
      }).triggers
    ).toEqual([
      { label: 'Tab: Land Parcels', href: `${pagesHref}#tab-land-parcels` }
    ])
  })

  test('lists the banner, then each tab in case-tab order, with what each writes', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { display: true })],
      pages: withBanner({
        later: { link: { text: 'Later', index: 9 }, action: { late: 'A' } },
        sooner: { link: { text: 'Sooner', index: 2 }, action: { soon: 'A' } }
      })
    })

    expect(card.triggers.map(({ label }) => label)).toEqual([
      'Banner button',
      'Tab: Sooner',
      'Tab: Later'
    ])
    expect(card.writes).toEqual([
      { kind: 'timeline' },
      { kind: 'actionData', path: 'actionData.soon' },
      { kind: 'actionData', path: 'actionData.late' }
    ])
  })

  test('a tab that maps two keys to the action fires it twice, in map order', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A')],
      pages: withBanner({
        land: { link: { text: 'Land' }, action: { first: 'A', second: 'A' } }
      })
    })

    expect(card.triggers.map(({ label }) => label)).toEqual([
      'Tab: Land',
      'Tab: Land'
    ])
    expect(card.writes).toEqual([
      { kind: 'actionData', path: 'actionData.first' },
      { kind: 'actionData', path: 'actionData.second' }
    ])
  })

  test('escapes a tab key in its link', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({ 'a b': { action: { a: 'A' } } })
      }).triggers[0].href
    ).toBe(`${pagesHref}#tab-a%20b`)
  })
})

describe('toWorkflowIntegrations writes', () => {
  test('no supplementary data for a target reached only from a tab', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', {
            target: {
              targetNode: 'parcels',
              dataType: 'ARRAY',
              position: null,
              place: 'append'
            }
          })
        ],
        pages: withBanner({ land: { action: { got: 'A' } } })
      }).writes
    ).toEqual([{ kind: 'actionData', path: 'actionData.got' }])
  })

  test('only a timeline event for a banner button with no target', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A', { display: true })],
        pages: withBanner()
      }).writes
    ).toEqual([{ kind: 'timeline' }])
  })

  test('nothing for an action nothing triggers', () => {
    expect(
      cardOf({ endpoints: [parcels], externalActions: [action('A')] }).writes
    ).toEqual([])
  })
})

describe('toWorkflowIntegrations sends', () => {
  test('path and body parameters in definition order, never headers or other kinds', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', {
            endpoint: {
              code: 'parcels',
              endpointParams: {
                BODY: { reason: '', count: 3 },
                HEADERS: { 'x-api-key': '$.secret' },
                QUERY: { page: '1' },
                PATH: { sbi: '$.payload.identifiers.sbi' }
              }
            }
          })
        ]
      }).sends
    ).toEqual([
      { kind: 'BODY', name: 'reason', expression: '' },
      { kind: 'BODY', name: 'count', expression: '3' },
      { kind: 'PATH', name: 'sbi', expression: '$.payload.identifiers.sbi' }
    ])
  })
})

describe('toWorkflowIntegrations duplicate codes', () => {
  test('only the first action with a code runs, so a later one has no trigger, writes or anchor', () => {
    const integrations = integrationsOf({
      endpoints: [parcels],
      externalActions: [
        action('A', { display: true }),
        action('A', { display: true })
      ],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(integrations.cards[0].anchor).toBe('action-A')
    expect(integrations.cards[1]).toEqual(
      expect.objectContaining({
        anchor: null,
        triggers: [],
        writes: [],
        problems: ['Not triggered: no button, no tab']
      })
    )
  })

  test("a later shown duplicate's button runs the first action, with the first action's writes", () => {
    const integrations = integrationsOf({
      endpoints: [parcels],
      externalActions: [
        action('A', {
          display: false,
          target: {
            targetNode: 'payment',
            dataType: 'OBJECT',
            position: null,
            key: 'id',
            place: 'append'
          }
        }),
        action('A', { display: true })
      ],
      pages: withBanner()
    })

    expect(integrations.cards[0].triggers).toEqual([
      { label: 'Banner button', href: `${pagesHref}#banner` }
    ])
    expect(integrations.cards[0].writes).toEqual([
      {
        kind: 'supplementary',
        path: 'supplementaryData.payment',
        detail: 'object · append'
      }
    ])
    expect(integrations.cards[1].problems).toEqual([
      'Not triggered: no button, no tab'
    ])
  })

  test('a later duplicate still shows its own endpoint, which counts as used by nothing', () => {
    const other = endpoint('other', { service: 'OTHER', method: 'PUT' })
    const integrations = integrationsOf(
      {
        endpoints: [parcels, other],
        externalActions: [
          action('A', { display: true }),
          action('A', { endpoint: { code: 'other' } })
        ],
        pages: withBanner()
      },
      [null, 'https://other.example/parcels']
    )

    expect(integrations.cards[1].call).toEqual({
      method: 'PUT',
      endpointCode: 'other',
      address: {
        code: 'other',
        service: 'OTHER',
        url: 'https://other.example/parcels'
      }
    })
    expect(integrations.unusedEndpoints).toEqual([
      {
        code: 'other',
        method: 'PUT',
        address: {
          code: 'other',
          service: 'OTHER',
          url: 'https://other.example/parcels'
        }
      }
    ])
  })

  test('a second endpoint with a used code is used by nothing, at its own address', () => {
    const integrations = integrationsOf(
      {
        endpoints: [parcels, endpoint('parcels', { path: '/v2/parcels' })],
        externalActions: [action('A', { display: true })],
        pages: withBanner()
      },
      ['https://land.example/parcels', 'https://land.example/v2/parcels']
    )

    expect(integrations.cards[0].call?.address.url).toBe(
      'https://land.example/parcels'
    )
    expect(integrations.unusedEndpoints).toEqual([
      {
        code: 'parcels',
        method: 'GET',
        address: {
          code: 'parcels',
          service: 'LAND_DATA',
          url: 'https://land.example/v2/parcels'
        }
      }
    ])
  })
})

describe('toWorkflowIntegrations with no external actions', () => {
  test.each([
    ['absent', undefined],
    ['empty', []]
  ])('%s, every endpoint is used by nothing', (_, externalActions) => {
    expect(integrationsOf({ endpoints: [parcels], externalActions })).toEqual({
      cards: [],
      unusedEndpoints: [
        {
          code: 'parcels',
          method: 'GET',
          address: { code: 'parcels', service: 'LAND_DATA', url: null }
        }
      ]
    })
  })

  test('and no endpoints, there is nothing to show', () => {
    expect(integrationsOf({})).toEqual({ cards: [], unusedEndpoints: [] })
  })
})
