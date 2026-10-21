import type { GrantAgreement } from '../use-cases/get-grant-page.use-case.ts'
import { agreementDefinition } from '../use-cases/test-fixtures.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type { AgreementTab } from './grant-agreement.view-model.ts'
import { toJsonView } from './json-viewer.view-model.ts'

const addresses = [
  {
    process: 'GENERATE_OFFER',
    service: 'LAND_DATA',
    url: 'https://land-data.example/api/v2/parcels/{sbi}'
  },
  { process: 'FETCH_TERMS', service: 'AGREEMENT_DOCS', url: null }
]

const agreement = (
  overrides: Partial<GrantAgreement> = {}
): GrantAgreement => ({
  definition: agreementDefinition,
  addresses,
  problem: null,
  ...overrides
})

type Loadable = Extract<AgreementTab, { problem: null }>

const loadable = (overrides: Partial<GrantAgreement> = {}): Loadable => {
  const tab = toAgreementTab(agreement(overrides))

  if (tab.problem !== null) {
    throw new Error(`expected a loadable agreement, got ${tab.problem}`)
  }

  return tab
}

const withDefinition = (
  changes: Partial<GrantAgreement['definition']>
): Loadable => loadable({ definition: { ...agreementDefinition, ...changes } })

describe('toAgreementTab', () => {
  test('gives the facts in two columns', () => {
    expect(loadable().facts).toEqual([
      [
        {
          id: 'code',
          label: 'Code',
          kind: 'mono',
          text: 'woodland-creation',
          from: null
        },
        {
          id: 'number-prefix',
          label: 'Number prefix',
          kind: 'mono',
          text: 'WC',
          from: null
        },
        {
          id: 'created-as',
          label: 'Created as',
          kind: 'mono',
          text: 'offered',
          from: null
        }
      ],
      [
        {
          id: 'application-data',
          label: 'Application data',
          kind: 'mono',
          text: '$.input.answers',
          from: null
        },
        {
          id: 'on-create',
          label: 'On create',
          kind: 'codes',
          codes: ['GENERATE_OFFER']
        },
        {
          id: 'templates',
          label: 'Templates',
          kind: 'codes',
          codes: ['terms.standard', 'terms.welsh']
        }
      ]
    ])
  })

  test('shows application data that is not a string as one line of JSON', () => {
    const [, [application]] = withDefinition({
      create: { target: 'offered', application: { sbi: '$.input.sbi' } }
    }).facts

    expect(application).toMatchObject({
      kind: 'mono',
      text: '{"sbi":"$.input.sbi"}'
    })
  })

  test('shows a dash for no processes on create and no templates', () => {
    const [, [, onCreate, templates]] = withDefinition({
      create: { target: 'offered', application: '$.input.answers' },
      templates: undefined
    }).facts

    expect(onCreate).toMatchObject({ kind: 'text', text: '—' })
    expect(templates).toMatchObject({ kind: 'text', text: '—' })
  })

  test('gives a row per action, with the state cells on its first row only', () => {
    const [first, ...rest] = loadable().states.slice(0, 3)

    expect(first).toEqual({
      state: {
        name: 'offered',
        initial: true,
        pinsVersion: false,
        page: 'offered',
        pageProcesses: []
      },
      action: {
        name: 'accept',
        target: 'accepted',
        page: 'accept',
        required: 1,
        runs: ['CREATE_AGREEMENT_PAYMENT']
      }
    })
    expect(rest).toEqual([
      {
        state: null,
        action: {
          name: 'withdraw',
          target: 'withdrawn',
          page: null,
          required: null,
          runs: []
        }
      },
      {
        state: null,
        action: {
          name: 'cancel',
          target: 'cancelled',
          page: null,
          required: null,
          runs: []
        }
      }
    ])
  })

  test('marks accepted as the state that pins the version, with its page processes', () => {
    expect(loadable().states[3].state).toEqual({
      name: 'accepted',
      initial: false,
      pinsVersion: true,
      page: 'accepted',
      pageProcesses: ['GENERATE_OFFER']
    })
  })

  test('gives a state with no actions one row and no action', () => {
    expect(loadable().states.slice(4)).toEqual([
      {
        state: {
          name: 'withdrawn',
          initial: false,
          pinsVersion: false,
          page: 'withdrawn',
          pageProcesses: []
        },
        action: null
      },
      {
        state: {
          name: 'cancelled',
          initial: false,
          pinsVersion: false,
          page: null,
          pageProcesses: []
        },
        action: null
      },
      {
        state: {
          name: 'terminated',
          initial: false,
          pinsVersion: false,
          page: 'terminated',
          pageProcesses: []
        },
        action: null
      }
    ])
  })

  test('gives each page its layout, section ids and distinct component types in order', () => {
    expect(loadable().pages).toEqual([
      {
        id: 'document',
        title: 'Agreement document',
        layout: 'document',
        sections: ['parties', 'actions', 'payments', 'terms'],
        components: ['heading']
      },
      {
        id: 'offered',
        title: 'Review your agreement offer',
        layout: null,
        sections: null,
        components: ['summary-list', 'button']
      },
      {
        id: 'accept',
        title: 'Accept your agreement offer',
        layout: null,
        sections: null,
        components: ['form']
      }
    ])
  })

  test("gives an endpoint process GAS's address for it, and a handler no call", () => {
    expect(loadable().processes).toEqual([
      {
        name: 'GENERATE_OFFER',
        type: 'endpoint',
        call: {
          method: 'POST',
          url: 'https://land-data.example/api/v2/parcels/{sbi}',
          service: 'LAND_DATA'
        },
        outputs: ['offer', 'totalAmountPence']
      },
      {
        name: 'FETCH_TERMS',
        type: 'endpoint',
        call: { method: 'GET', url: null, service: 'AGREEMENT_DOCS' },
        outputs: ['terms']
      },
      {
        name: 'CREATE_AGREEMENT_PAYMENT',
        type: 'handler',
        call: null,
        outputs: []
      }
    ])
  })

  test('gives no processes for a definition that has none', () => {
    expect(withDefinition({ processDefinitions: undefined }).processes).toEqual(
      []
    )
  })

  test('views the definition as stored', () => {
    expect(loadable().raw).toEqual(toJsonView(agreementDefinition))
  })

  test('gives only the problem and the definition as stored when GAS cannot load it', () => {
    const definition = { ...agreementDefinition, code: 'other' }

    expect(
      toAgreementTab(
        agreement({
          definition,
          addresses: [],
          problem: 'Agreement definition code "other" does not match'
        })
      )
    ).toEqual({
      problem: 'Agreement definition code "other" does not match',
      raw: toJsonView(definition)
    })
  })
})
