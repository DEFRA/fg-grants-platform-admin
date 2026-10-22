import type {
  AgreementDefinition,
  GrantAgreement
} from '../use-cases/get-grant-page.use-case.ts'
import { agreementDefinition } from '../use-cases/test-fixtures.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type {
  AgreementContext,
  AgreementTab
} from './grant-agreement.view-model.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import { toMappingValue } from './mapping-table.ts'

const addresses = [
  {
    process: 'GENERATE_OFFER',
    service: 'LAND_DATA',
    url: 'https://land-data.example/api/v2/parcels/{sbi}'
  },
  { process: 'FETCH_TERMS', service: 'AGREEMENT_DOCS', url: null }
]

const context: AgreementContext = {
  version: '3.16.3',
  fetchStatus: 'fetched',
  hrefs: { phases: '/phases', payment: '/payment' }
}

const agreement = (
  overrides: Partial<GrantAgreement> = {}
): GrantAgreement => ({
  definition: agreementDefinition,
  addresses,
  problem: null,
  ...overrides
})

type Loadable = Extract<AgreementTab, { problem: null }>

const loadable = (
  overrides: Partial<GrantAgreement> = {},
  given: AgreementContext = context
): Loadable => {
  const tab = toAgreementTab(agreement(overrides), given)

  if (tab.problem !== null) {
    throw new Error(`expected a loadable agreement, got ${tab.problem}`)
  }

  return tab
}

const withDefinition = (changes: Partial<AgreementDefinition>): Loadable =>
  loadable({ definition: { ...agreementDefinition, ...changes } })

const factOf = (tab: Loadable, id: string) =>
  tab.facts.flat().find((fact) => fact.id === id)

/** After qa-complex 1.1.0: a standalone button, a form, and a button whose action has no page. */
const qaStates: AgreementDefinition['states'] = {
  offered: {
    page: 'offered',
    processes: ['CHECK_TOTALS_ON_VIEW'],
    on: {
      accept: { target: 'accepted', page: 'accept' },
      withdraw: { target: 'withdrawn' },
      refresh: {
        target: 'offered',
        page: 'refresh',
        values: { totalAmountPence: '$.agreement.totalAmountPence' }
      }
    }
  },
  accepted: { page: 'accepted', on: { terminate: { target: 'terminated' } } },
  withdrawn: { page: 'withdrawn' },
  terminated: {}
}

const qaPages: AgreementDefinition['pages'] = {
  document: {
    title: 'Agreement document',
    layout: 'document',
    contents: true,
    print: true,
    watermarks: { offered: 'DRAFT - TEST DATA' },
    backLink: { href: { urlTemplate: '/agreements/{agreementNumber}' } },
    sections: [
      { id: 'parties' },
      { id: 'acceptance', condition: '$.agreement.acceptedAt' }
    ],
    components: [{ component: 'heading' }]
  },
  accepted: {
    title: 'Agreement accepted',
    components: [
      { component: 'panel' },
      { component: 'button', text: 'End this agreement', action: 'terminate' }
    ]
  },
  offered: {
    title: 'Your offer',
    backLink: { href: '/agreements/current' },
    components: [
      {
        component: 'grid-row',
        components: [
          {
            component: 'grid-column',
            components: [
              {
                component: 'button',
                text: 'Review and accept',
                action: 'accept'
              }
            ]
          }
        ]
      },
      { component: 'button', text: 'Withdraw this offer', action: 'withdraw' },
      { component: 'button', text: 'Archive', action: 'archive' }
    ]
  },
  accept: {
    title: 'Accept your offer',
    components: [
      {
        component: 'form',
        action: 'accept',
        components: [{ component: 'button', text: 'Accept offer' }]
      }
    ]
  },
  refresh: { title: 'Refresh your offer', components: [] },
  withdrawn: { title: 'Offer withdrawn', components: [] }
}

const qaComplex = (): Loadable =>
  withDefinition({ states: qaStates, pages: qaPages })

describe('toAgreementTab: facts', () => {
  test('names each fact in words, with what reads it from where', () => {
    expect(loadable().facts).toEqual([
      [
        { id: 'code', label: 'Code', kind: 'mono', text: 'woodland-creation' },
        {
          id: 'number-prefix',
          label: 'Number prefix',
          kind: 'mono',
          text: 'WC'
        },
        {
          id: 'application-data',
          label: 'Reads application answers from',
          kind: 'mono',
          text: '$.input.answers'
        },
        {
          id: 'created-when',
          label: 'Created when',
          kind: 'created-when',
          href: '/phases'
        }
      ],
      [
        {
          id: 'on-create',
          label: 'Runs on create',
          kind: 'codes',
          codes: [{ code: 'GENERATE_OFFER', title: null }]
        },
        {
          id: 'templates',
          label: 'Text templates',
          kind: 'codes',
          codes: [
            { code: 'terms.standard', title: null },
            { code: 'terms.welsh', title: null }
          ]
        }
      ]
    ])
  })

  test('shows application data that is not a string as one line of JSON', () => {
    const tab = withDefinition({
      create: { target: 'offered', application: { sbi: '$.input.sbi' } }
    })

    expect(factOf(tab, 'application-data')).toMatchObject({
      text: '{"sbi":"$.input.sbi"}'
    })
  })

  test("gives each text template its template's words", () => {
    const tab = withDefinition({
      templates: {
        capitalItems: {
          'QA-HEDGE': {
            content: [
              { component: 'paragraph', text: 'Hedgerow: @.quantity @.unit' }
            ]
          },
          'QA-POND': {}
        }
      }
    })

    expect(factOf(tab, 'templates')).toMatchObject({
      codes: [
        { code: 'capitalItems.QA-HEDGE', title: 'Hedgerow: @.quantity @.unit' },
        { code: 'capitalItems.QA-POND', title: null }
      ]
    })
  })

  test('lists no processes on create and no templates as none', () => {
    const tab = withDefinition({
      create: { target: 'offered', application: '$.input.answers' },
      templates: undefined
    })

    expect(factOf(tab, 'on-create')).toMatchObject({ codes: [] })
    expect(factOf(tab, 'templates')).toMatchObject({ codes: [] })
  })

  test('lists the root endpoints with the address GAS has for each', () => {
    const tab = loadable({
      definition: {
        ...agreementDefinition,
        endpoints: [
          {
            code: 'qa-health',
            method: 'GET',
            path: '/health',
            service: 'QA_HEALTH'
          },
          { code: 'qa-unset', method: 'POST', path: '/qa', service: 'QA_UNSET' }
        ]
      },
      endpointAddresses: [
        { code: 'qa-health', service: 'QA_HEALTH', url: 'http://cw/health' },
        { code: 'qa-unset', service: 'QA_UNSET', url: null }
      ],
      missingServiceUrls: ['QA_UNSET_URL']
    })

    expect(factOf(tab, 'endpoints')).toEqual({
      id: 'endpoints',
      label: 'Endpoints',
      kind: 'endpoints',
      endpoints: [
        {
          code: 'qa-health',
          method: 'GET',
          path: '/health',
          service: 'QA_HEALTH',
          url: 'http://cw/health',
          unset: false
        },
        {
          code: 'qa-unset',
          method: 'POST',
          path: '/qa',
          service: 'QA_UNSET',
          url: null,
          unset: true
        }
      ]
    })
  })

  test('says nothing of whether an endpoint is configured when GAS does not say', () => {
    const tab = withDefinition({
      endpoints: [{ code: 'qa', method: 'GET', path: '/', service: 'QA' }]
    })

    expect(factOf(tab, 'endpoints')).toMatchObject({
      endpoints: [{ url: null, unset: null }]
    })
  })

  test("says a process call's service is unset only when GAS lists its variable", () => {
    const [generate, terms] = loadable({
      missingServiceUrls: ['AGREEMENT_DOCS_URL']
    }).processes

    expect(generate.call?.unset).toBe(false)
    expect(terms.call?.unset).toBe(true)
  })

  test('has no Endpoints fact for a definition with no root endpoints', () => {
    expect(factOf(loadable(), 'endpoints')).toBeUndefined()
  })
})

describe('toAgreementTab: unset service URLs', () => {
  test('passes on the URLs GAS says are unset', () => {
    expect(
      loadable({ missingServiceUrls: ['QA_COMPLEX_UNSET_URL'] })
        .missingServiceUrls
    ).toEqual(['QA_COMPLEX_UNSET_URL'])
  })

  test('says none when an older GAS does not say, even with an address it has no URL for', () => {
    expect(loadable().missingServiceUrls).toEqual([])
  })
})

describe('toAgreementTab: states', () => {
  test('groups each state with its actions, saying what each requires and runs', () => {
    const [offered] = loadable().states

    expect(offered).toEqual({
      name: 'offered',
      initial: true,
      locksVersion: false,
      page: 'offered',
      pageProcesses: [],
      actions: [
        {
          name: 'accept',
          target: 'accepted',
          stays: false,
          page: 'accept',
          requires: [
            {
              name: 'confirm',
              value: '$.form.confirm',
              message: 'Confirm you have read the terms'
            }
          ],
          runs: ['CREATE_AGREEMENT_PAYMENT'],
          sets: []
        },
        {
          name: 'withdraw',
          target: 'withdrawn',
          stays: false,
          page: null,
          requires: [],
          runs: [],
          sets: []
        },
        {
          name: 'cancel',
          target: 'cancelled',
          stays: false,
          page: null,
          requires: [],
          runs: [],
          sets: []
        }
      ]
    })
  })

  test('marks accepted as the state that locks the version, with its page processes', () => {
    const accepted = loadable().states[1]

    expect(accepted).toMatchObject({
      name: 'accepted',
      initial: false,
      locksVersion: true,
      pageProcesses: ['GENERATE_OFFER']
    })
    expect(loadable().pageProcesses).toBe(true)
  })

  test('gives a state with no actions none, and no page as null', () => {
    expect(loadable().states[3]).toEqual({
      name: 'cancelled',
      initial: false,
      locksVersion: false,
      page: null,
      pageProcesses: [],
      actions: []
    })
  })

  test('says a move to its own state stays, and the fields a move sets', () => {
    const refresh = qaComplex().states[0].actions[2]

    expect(refresh).toMatchObject({
      name: 'refresh',
      stays: true,
      sets: ['totalAmountPence']
    })
  })

  test('leaves the page view column out when no state runs a process on a page view', () => {
    const states = Object.fromEntries(
      Object.entries(agreementDefinition.states).map(([name, state]) => [
        name,
        { ...state, processes: undefined }
      ])
    )

    expect(withDefinition({ states }).pageProcesses).toBe(false)
  })
})

describe('toAgreementTab: pages', () => {
  test('orders the pages as the states show them, then any no state shows', () => {
    expect(qaComplex().pages.map(({ id }) => id)).toEqual([
      'offered',
      'accept',
      'refresh',
      'accepted',
      'withdrawn',
      'document'
    ])
  })

  test('says what changes what the customer sees, beyond the components', () => {
    const document = qaComplex().pages.find(({ id }) => id === 'document')

    expect(document).toMatchObject({
      title: 'Agreement document',
      details: [
        { kind: 'layout', layout: 'document' },
        { kind: 'watermark', state: 'offered', text: 'DRAFT - TEST DATA' },
        { kind: 'print' },
        { kind: 'contents' },
        { kind: 'back', href: '/agreements/{agreementNumber}' },
        { kind: 'section', id: 'parties', condition: null },
        {
          kind: 'section',
          id: 'acceptance',
          condition: '$.agreement.acceptedAt'
        }
      ],
      components: ['heading'],
      buttons: []
    })
  })

  test('lists the buttons nested anywhere on a page, flagging one whose action has no page or is not an action there', () => {
    const offered = qaComplex().pages[0]

    expect(offered.details).toEqual([
      { kind: 'back', href: '/agreements/current' }
    ])
    expect(offered.buttons).toEqual([
      {
        text: 'Review and accept',
        action: 'accept',
        form: false,
        page: 'accept',
        problem: null,
        states: ['offered']
      },
      {
        text: 'Withdraw this offer',
        action: 'withdraw',
        form: false,
        page: null,
        problem: 'no-page',
        states: ['offered']
      },
      {
        text: 'Archive',
        action: 'archive',
        form: false,
        page: null,
        problem: 'not-in-state',
        states: ['offered']
      }
    ])
  })

  test("names a form's button by its text, needing no page of its action", () => {
    const accept = qaComplex().pages[1]

    expect(accept.buttons).toEqual([
      {
        text: 'Accept offer',
        action: 'accept',
        form: true,
        page: null,
        problem: null,
        states: ['offered']
      }
    ])
  })

  test('flags a standalone button on the accepted page whose action has no page', () => {
    const accepted = qaComplex().pages.find(({ id }) => id === 'accepted')

    expect(accepted?.buttons).toMatchObject([
      { text: 'End this agreement', action: 'terminate', problem: 'no-page' }
    ])
  })
})

describe('toAgreementTab: created with', () => {
  test('lists what the agreement is created with, nested as written', () => {
    const tab = withDefinition({
      create: {
        target: 'offered',
        application: '$.input.answers',
        values: {
          schemeCode: 'QA-COMPLEX',
          actions: {
            itemsRef: '$.application.annualActions',
            items: { ref: '@.ref' }
          }
        }
      }
    })

    expect(tab.createdWith).toEqual([
      {
        field: 'schemeCode',
        depth: 0,
        kind: 'value',
        value: toMappingValue('QA-COMPLEX')
      },
      {
        field: 'actions',
        depth: 0,
        kind: 'each',
        forEach: '$.application.annualActions'
      },
      { field: 'ref', depth: 1, kind: 'value', value: toMappingValue('@.ref') }
    ])
  })

  test('gives no rows when the definition creates with no values', () => {
    expect(loadable().createdWith).toEqual([])
  })
})

describe('toAgreementTab: processes', () => {
  test("gives an endpoint process its type in words, GAS's address and where its outputs land", () => {
    const [generate, terms, payment] = loadable().processes

    expect(generate).toEqual({
      name: 'GENERATE_OFFER',
      type: 'HTTP call',
      requestsPayment: false,
      call: {
        method: 'POST',
        service: 'LAND_DATA',
        path: '/api/v2/parcels/{sbi}',
        url: 'https://land-data.example/api/v2/parcels/{sbi}',
        unset: null
      },
      sends: [
        {
          depth: 0,
          field: 'sbi',
          kind: 'value',
          value: toMappingValue('$.application.sbi')
        }
      ],
      bodyOnGet: false,
      outputs: [
        { field: 'offer', value: toMappingValue('$.response.offer') },
        {
          field: 'totalAmountPence',
          value: toMappingValue('$.response.totalAmountPence')
        }
      ],
      lands: ['saved', 'page']
    })
    expect(terms).toMatchObject({
      name: 'FETCH_TERMS',
      call: { url: null, path: '/terms', unset: null },
      lands: []
    })
    expect(payment).toMatchObject({
      name: 'CREATE_AGREEMENT_PAYMENT',
      type: 'Built into GAS',
      requestsPayment: true,
      call: null,
      lands: ['saved']
    })
    expect(loadable().paymentHref).toBe('/payment')
  })

  test('says what a process sends, and when a body goes with a GET', () => {
    const [lookUp] = withDefinition({
      processDefinitions: {
        LOOK_UP_SCHEME_NAME: {
          type: 'endpoint',
          endpoint: { method: 'GET', path: '/health', service: 'QA_HEALTH' },
          request: {
            body: { probe: 'qa-complex', farmType: '$.application.farmType' }
          },
          output: {}
        }
      }
    }).processes

    expect(lookUp).toMatchObject({
      sends: [
        { field: 'probe', value: toMappingValue('qa-complex') },
        { field: 'farmType', value: toMappingValue('$.application.farmType') }
      ],
      bodyOnGet: true
    })
  })

  test('says the outputs of a process run only on page views are for the page only', () => {
    const tab = withDefinition({
      states: qaStates,
      pages: qaPages,
      processDefinitions: {
        CHECK_TOTALS_ON_VIEW: {
          type: 'endpoint',
          endpoint: { method: 'GET', path: '/health', service: 'QA_HEALTH' },
          request: { body: {} },
          output: { totalAmountPence: 'jsonata:$.agreement.totalAmountPence' }
        }
      }
    })

    expect(tab.processes[0].lands).toEqual(['page'])
  })

  test('gives no processes for a definition that has none', () => {
    expect(withDefinition({ processDefinitions: undefined }).processes).toEqual(
      []
    )
  })
})

describe('toAgreementTab: a definition GAS cannot load', () => {
  test('views the definition as stored', () => {
    expect(loadable().raw).toEqual(toJsonView(agreementDefinition))
  })

  test('gives only the problem, the major and the definition as stored', () => {
    expect(
      toAgreementTab(agreement({ problem: 'bad mapping' }), context)
    ).toEqual({
      problem: 'bad mapping',
      failed: false,
      major: '3',
      version: '3.16.3',
      raw: toJsonView(agreementDefinition)
    })
  })

  test('says GAS has marked the file unusable when its fetch failed for good', () => {
    expect(
      toAgreementTab(agreement({ problem: 'bad mapping' }), {
        ...context,
        fetchStatus: 'permanent_error'
      })
    ).toMatchObject({ failed: true })
  })
})
