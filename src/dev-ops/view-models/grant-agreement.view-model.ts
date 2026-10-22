import type {
  AgreementDefinition,
  GrantAgreement,
  ProcessAddress
} from '../use-cases/get-grant-page.use-case.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toCodesFact, toMonoFact } from './record-page.view-model.ts'
import type { Fact } from './record-page.view-model.ts'

/** Empty shows as "—". */
type Codes = string[]

interface StateCells {
  name: string
  initial: boolean
  pinsVersion: boolean
  page: string | null
  pageProcesses: Codes
}

interface ActionCells {
  name: string
  target: string
  page: string | null
  required: number | null
  runs: Codes
}

/** The state cells only on a state's first row; no action on a state that has none. */
interface StateRow {
  state: StateCells | null
  action: ActionCells | null
}

interface PageRow {
  id: string
  title: string
  layout: string | null
  sections: Codes | null
  components: Codes
}

interface ProcessRow {
  name: string
  type: string
  call: { method: string; url: string | null; service: string } | null
  outputs: Codes
}

/** A definition GAS cannot load gives its problem and nothing derived from it. */
export type AgreementTab =
  | { problem: string; raw: JsonView }
  | {
      problem: null
      facts: Fact[][]
      states: StateRow[]
      pages: PageRow[]
      processes: ProcessRow[]
      raw: JsonView
    }

type States = AgreementDefinition['states']

const pinnedState = 'accepted'

const toApplicationData = (application: unknown): string | null =>
  typeof application === 'string'
    ? application
    : (JSON.stringify(application) ?? null)

const toTemplateKeys = (templates: AgreementDefinition['templates']): Codes =>
  Object.entries(templates ?? {}).flatMap(([group, keys]) =>
    Object.keys(keys).map((key) => `${group}.${key}`)
  )

const toFacts = ({
  code,
  agreementNumberPrefix,
  create,
  templates
}: AgreementDefinition): Fact[][] => [
  [
    toMonoFact('code', 'Code', code),
    toMonoFact('number-prefix', 'Number prefix', agreementNumberPrefix),
    toMonoFact('created-as', 'Created as', create.target)
  ],
  [
    toMonoFact(
      'application-data',
      'Application data',
      toApplicationData(create.application)
    ),
    toCodesFact('on-create', 'On create', create.processes ?? []),
    toCodesFact('templates', 'Templates', toTemplateKeys(templates))
  ]
]

type Transition = NonNullable<States[string]['on']>[string]

const toStateCells = (
  name: string,
  { page, processes }: States[string],
  initialState: string
): StateCells => ({
  name,
  initial: name === initialState,
  pinsVersion: name === pinnedState,
  page: page ?? null,
  pageProcesses: processes ?? []
})

const toRequired = ({ validation }: Transition): number | null =>
  validation ? validation.required.length : null

const toActionCells = ([name, transition]: [
  string,
  Transition
]): ActionCells => ({
  name,
  target: transition.target,
  page: transition.page ?? null,
  required: toRequired(transition),
  runs: transition.processes ?? []
})

const toStateRows =
  (initialState: string) =>
  ([name, state]: [string, States[string]]): StateRow[] => {
    const cells = toStateCells(name, state, initialState)
    const actions = Object.entries(state.on ?? {}).map(toActionCells)

    return actions.length
      ? actions.map((action, index) => ({
          state: index === 0 ? cells : null,
          action
        }))
      : [{ state: cells, action: null }]
  }

const toPageRows = (pages: AgreementDefinition['pages']): PageRow[] =>
  Object.entries(pages).map(([id, page]) => ({
    id,
    title: page.title,
    layout: page.layout ?? null,
    sections: page.sections?.map((section) => section.id) ?? null,
    components: [...new Set(page.components.map((c) => c.component))]
  }))

type Process = NonNullable<AgreementDefinition['processDefinitions']>[string]

const toCall = (
  name: string,
  process: Process,
  addresses: ProcessAddress[]
): ProcessRow['call'] => {
  if (process.type !== 'endpoint') {
    return null
  }

  const address = addresses.find((candidate) => candidate.process === name)

  return {
    method: process.endpoint.method,
    url: address?.url ?? null,
    service: process.endpoint.service
  }
}

const toProcessRows = (
  processes: AgreementDefinition['processDefinitions'],
  addresses: ProcessAddress[]
): ProcessRow[] =>
  Object.entries(processes ?? {}).map(([name, process]) => ({
    name,
    type: process.type,
    call: toCall(name, process, addresses),
    outputs: process.type === 'endpoint' ? Object.keys(process.output) : []
  }))

export const toAgreementTab = ({
  definition,
  addresses,
  problem
}: GrantAgreement): AgreementTab => {
  const raw = toJsonView(definition)

  if (problem !== null) {
    return { problem, raw }
  }

  return {
    problem,
    facts: toFacts(definition),
    states: Object.entries(definition.states).flatMap(
      toStateRows(definition.create.target)
    ),
    pages: toPageRows(definition.pages),
    processes: toProcessRows(definition.processDefinitions, addresses),
    raw
  }
}
