import type { FetchStatus } from '../repositories/config-versions.ts'
import type {
  AgreementComponent,
  AgreementDefinition,
  EndpointAddress,
  GrantAgreement
} from '../repositories/grants.repository.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toMappingRows, toMappingValue } from './mapping-table.ts'
import type { MappingRow, MappingValue } from './mapping-table.ts'

/** Each with what it reads as, where the definition says. */
interface Code {
  code: string
  title: string | null
}

interface Call {
  method: string
  path: string
  url: string | null
  service: string
  /** Whether GAS lists the service's variable in `missingServiceUrls`; null from an older GAS, which does not say. */
  unset: boolean | null
}

interface EndpointRow extends Call {
  code: string
}

export type AgreementFact = { id: string; label: string } & (
  | { kind: 'mono'; text: string }
  | { kind: 'codes'; codes: Code[] }
  | { kind: 'created-when'; href: string }
  | { kind: 'endpoints'; endpoints: EndpointRow[] }
)

interface Rule {
  name: string
  value: string
  message: string | null
}

interface ActionRow {
  name: string
  target: string
  /** Moves to the state it is in. */
  stays: boolean
  page: string | null
  requires: Rule[]
  runs: string[]
  sets: string[]
}

interface StateGroup {
  name: string
  initial: boolean
  locksVersion: boolean
  page: string | null
  pageProcesses: string[]
  actions: ActionRow[]
}

type ButtonProblem = 'no-page' | 'not-in-state' | null

interface ButtonRow {
  text: string
  action: string
  form: boolean
  /** The page the action prepares, for a standalone button. */
  page: string | null
  problem: ButtonProblem
  /** The states the page is shown in, for a button whose action is in none of them. */
  states: string[]
}

/** What changes what the customer sees, beyond the page's components. */
type PageDetail =
  | { kind: 'layout'; layout: string }
  | { kind: 'watermark'; state: string; text: string }
  | { kind: 'print' | 'contents' }
  | { kind: 'back'; href: string }
  | { kind: 'section'; id: string; condition: MappingValue | null }

interface PageRow {
  id: string
  title: string
  details: PageDetail[]
  components: string[]
  buttons: ButtonRow[]
}

type Lands = 'saved' | 'page'

interface ProcessRow {
  name: string
  type: string
  requestsPayment: boolean
  call: Call | null
  sends: MappingRow[]
  /** A body sent with a GET, which some servers drop. */
  bodyOnGet: boolean
  outputs: MappingRow[]
  lands: Lands[]
}

/** A definition GAS cannot load gives its problem and nothing derived from it. */
export type AgreementTab =
  | {
      problem: string
      /** GAS has marked the file unusable, so it falls back. */
      failed: boolean
      major: string
      version: string
      raw: JsonView
    }
  | {
      problem: null
      major: string
      paymentHref: string | null
      facts: AgreementFact[][]
      missingServiceUrls: string[]
      states: StateGroup[]
      /** No state runs any process on a page view, so the column is left out. */
      pageProcesses: boolean
      pages: PageRow[]
      createdWith: MappingRow[]
      processes: ProcessRow[]
      raw: JsonView
    }

export interface AgreementContext {
  version: string
  /** GAS's own fetch status for the agreement file. */
  fetchStatus: FetchStatus | null
  hrefs: { phases: string; payment: string | null }
}

type States = AgreementDefinition['states']
type State = States[string]
type Transition = NonNullable<State['on']>[string]
type Process = NonNullable<AgreementDefinition['processDefinitions']>[string]

/** GAS keeps an agreement on the definition it was accepted under from here on (`load-agreement-definition.js`). */
const lockedState = 'accepted'

const toApplicationData = (application: unknown): string =>
  typeof application === 'string'
    ? application
    : (JSON.stringify(application) ?? '')

const toTemplateText = (template: unknown): string | null => {
  const content = (template as { content?: AgreementComponent[] })?.content

  const texts = (Array.isArray(content) ? content : [])
    .map(({ text }) => text)
    .filter((text): text is string => typeof text === 'string')

  return texts.length ? texts.join(' ') : null
}

const toTemplateCodes = (templates: AgreementDefinition['templates']): Code[] =>
  Object.entries(templates ?? {}).flatMap(([group, keys]) =>
    Object.entries(keys).map(([key, template]) => ({
      code: `${group}.${key}`,
      title: toTemplateText(template)
    }))
  )

const toCodes = (codes: string[]): Code[] =>
  codes.map((code) => ({ code, title: null }))

/** GAS lists each missing variable by name, `{SERVICE}_URL`. */
const toUnset = (
  service: string,
  missing: string[] | undefined
): boolean | null => (missing ? missing.includes(`${service}_URL`) : null)

const toEndpointRows = (
  { endpoints = [] }: AgreementDefinition,
  addresses: EndpointAddress[] | undefined,
  missing: string[] | undefined
): EndpointRow[] =>
  endpoints.map(({ code, method, path, service }) => ({
    code,
    method,
    path,
    service,
    url: addresses?.find((address) => address.code === code)?.url ?? null,
    unset: toUnset(service, missing)
  }))

const toEndpointsFacts = (endpoints: EndpointRow[]): AgreementFact[] =>
  endpoints.length
    ? [{ id: 'endpoints', label: 'Endpoints', kind: 'endpoints', endpoints }]
    : []

const toFacts = (
  { definition, endpointAddresses, missingServiceUrls }: GrantAgreement,
  { hrefs }: AgreementContext
): AgreementFact[][] => [
  [
    { id: 'code', label: 'Code', kind: 'mono', text: definition.code },
    {
      id: 'number-prefix',
      label: 'Number prefix',
      kind: 'mono',
      text: definition.agreementNumberPrefix
    },
    {
      id: 'application-data',
      label: 'Reads application answers from',
      kind: 'mono',
      text: toApplicationData(definition.create.application)
    },
    {
      id: 'created-when',
      label: 'Created when',
      kind: 'created-when',
      href: hrefs.phases
    }
  ],
  [
    {
      id: 'on-create',
      label: 'Runs on create',
      kind: 'codes',
      codes: toCodes(definition.create.processes ?? [])
    },
    {
      id: 'templates',
      label: 'Text templates',
      kind: 'codes',
      codes: toTemplateCodes(definition.templates)
    },
    ...toEndpointsFacts(
      toEndpointRows(definition, endpointAddresses, missingServiceUrls)
    )
  ]
]

const orNone = <T>(value: T | undefined): T | null => value ?? null

const listOf = <T>(value: T[] | undefined): T[] => value ?? []

const entriesOf = <T>(value: Record<string, T> | undefined): [string, T][] =>
  Object.entries(value ?? {})

const isNode = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === 'object'

const toRule = ({ name, value, message }: Record<string, unknown>): Rule => ({
  name: String(name),
  value: typeof value === 'string' ? value : JSON.stringify(value),
  message: typeof message === 'string' ? message : null
})

const toActionRow =
  (state: string) =>
  ([name, transition]: [string, Transition]): ActionRow => ({
    name,
    target: transition.target,
    stays: transition.target === state,
    page: orNone(transition.page),
    requires: listOf(transition.validation?.required).map(toRule),
    runs: listOf(transition.processes),
    sets: entriesOf(transition.values).map(([field]) => field)
  })

const toStateGroup =
  (initialState: string) =>
  ([name, state]: [string, State]): StateGroup => ({
    name,
    initial: name === initialState,
    locksVersion: name === lockedState,
    page: state.page ?? null,
    pageProcesses: state.processes ?? [],
    actions: Object.entries(state.on ?? {}).map(toActionRow(name))
  })

/** The pages the states show, in state order, then any no state shows. */
const toPageOrder = ({ states, pages }: AgreementDefinition): string[] => {
  const shown = Object.values(states).flatMap((state) => [
    state.page,
    ...Object.values(state.on ?? {}).map(({ page }) => page)
  ])

  return [
    ...new Set(
      [...shown, ...Object.keys(pages)].filter(
        (id): id is string => id !== undefined && Object.hasOwn(pages, id)
      )
    )
  ]
}

const isControl = (node: Record<string, unknown>): boolean =>
  ['button', 'form'].includes(String(node.component)) &&
  typeof node.action === 'string'

/** Each standalone button and form, however deeply its page nests it. */
const toControls = (node: unknown): AgreementComponent[] => {
  if (!isNode(node)) {
    return []
  }

  if (Array.isArray(node)) {
    return node.flatMap(toControls)
  }

  return isControl(node)
    ? [node as AgreementComponent]
    : Object.values(node).flatMap(toControls)
}

const isButton = (node: Record<string, unknown>): boolean =>
  node.component === 'button' && typeof node.text === 'string'

/** The text of the first button inside a node, the one a form submits with. */
const firstButtonText = (node: unknown): string | null => {
  if (!isNode(node)) {
    return null
  }

  if (isButton(node)) {
    return String(node.text)
  }

  return (
    Object.values(node)
      .map(firstButtonText)
      .find((found) => found !== null) ?? null
  )
}

/** The states a page is shown in: as a state's own page, or as one of its actions' page. */
const statesShowing = (states: States, page: string): [string, State][] =>
  Object.entries(states).filter(
    ([, state]) =>
      state.page === page ||
      Object.values(state.on ?? {}).some((move) => move.page === page)
  )

/** A standalone button opens its action's page, so an action with none fails (`prepare-agreement-action.use-case.js`). */
const needsPage = (
  control: AgreementComponent,
  transition: Transition
): boolean => control.component === 'button' && !transition.page

const toProblem = (
  control: AgreementComponent,
  transition: Transition | undefined,
  shown: boolean
): ButtonProblem => {
  if (!transition) {
    return shown ? 'not-in-state' : null
  }

  return needsPage(control, transition) ? 'no-page' : null
}

const toControlText = (control: AgreementComponent, action: string): string =>
  control.component === 'form'
    ? (firstButtonText(control.components) ?? action)
    : String(control.text ?? action)

const toPreparedPage = (
  control: AgreementComponent,
  transition: Transition | undefined
): string | null =>
  control.component === 'button' ? orNone(transition?.page) : null

const toButtonRows = (
  { states }: AgreementDefinition,
  id: string,
  page: Page
): ButtonRow[] => {
  const showing = statesShowing(states, id)
  const moves = Object.fromEntries(
    showing.flatMap(([, state]) => entriesOf(state.on))
  )

  return toControls([page.components, page.sections]).map((control) => {
    const action = String(control.action)

    return {
      text: toControlText(control, action),
      action,
      form: control.component === 'form',
      page: toPreparedPage(control, moves[action]),
      problem: toProblem(control, moves[action], showing.length > 0),
      states: showing.map(([name]) => name)
    }
  })
}

const urlTemplateOf = (href: unknown): string | null => {
  const template = isNode(href) ? href.urlTemplate : undefined

  return typeof template === 'string' ? template : null
}

const toBackLink = (
  backLink: { href?: unknown } | undefined
): string | null => {
  const href = backLink?.href

  return typeof href === 'string' ? href : urlTemplateOf(href)
}

type Page = AgreementDefinition['pages'][string]

const when = <T>(shown: boolean, detail: T): T[] => (shown ? [detail] : [])

const toBackDetail = (page: Page): PageDetail[] => {
  const href = toBackLink(page.backLink)

  return href === null ? [] : [{ kind: 'back', href }]
}

const toPageDetails = (page: Page): PageDetail[] => [
  ...(page.layout ? [{ kind: 'layout', layout: page.layout } as const] : []),
  ...entriesOf(page.watermarks).map(
    ([state, text]): PageDetail => ({ kind: 'watermark', state, text })
  ),
  ...when<PageDetail>(page.print === true, { kind: 'print' }),
  ...when<PageDetail>(page.contents === true, { kind: 'contents' }),
  ...toBackDetail(page),
  ...listOf(page.sections).map(
    (section): PageDetail => ({
      kind: 'section',
      id: section.id,
      condition:
        section.condition === undefined
          ? null
          : toMappingValue(section.condition)
    })
  )
]

const toPageRow =
  (definition: AgreementDefinition) =>
  (id: string): PageRow => {
    const page = definition.pages[id]

    return {
      id,
      title: page.title,
      details: toPageDetails(page),
      components: [...new Set(page.components.map((c) => c.component))],
      buttons: toButtonRows(definition, id, page)
    }
  }

const toCall = (
  name: string,
  process: Process,
  { addresses, missingServiceUrls }: GrantAgreement
): Call | null => {
  if (process.type !== 'endpoint') {
    return null
  }

  const address = addresses.find((candidate) => candidate.process === name)

  return {
    ...process.endpoint,
    url: address?.url ?? null,
    unset: toUnset(process.endpoint.service, missingServiceUrls)
  }
}

const runsOnPage = (name: string, states: States): boolean =>
  Object.values(states).some((state) => listOf(state.processes).includes(name))

const runsOnMove = (name: string, states: States): boolean =>
  Object.values(states).some((state) =>
    entriesOf(state.on).some(([, move]) =>
      listOf(move.processes).includes(name)
    )
  )

/** On create or on a move its outputs are saved; on a page view they are not (`runPageProcesses`). */
const toLands = (
  name: string,
  { create, states }: AgreementDefinition
): Lands[] => {
  const saved: Lands[] =
    listOf(create.processes).includes(name) || runsOnMove(name, states)
      ? ['saved']
      : []

  return runsOnPage(name, states) ? [...saved, 'page'] : saved
}

const processTypes: Record<string, string> = {
  endpoint: 'HTTP call',
  handler: 'Built into GAS'
}

/** GAS's handler that requests the agreement payment. */
const paymentHandler = 'CREATE_AGREEMENT_PAYMENT'

const bodyOf = (process: Process): Record<string, unknown> | undefined =>
  process.type === 'endpoint' ? process.request.body : undefined

const outputsOf = (process: Process): Record<string, unknown> =>
  process.type === 'endpoint' ? (process.output ?? {}) : {}

const isGet = (process: Process): boolean =>
  process.type === 'endpoint' && process.endpoint.method.toUpperCase() === 'GET'

const toProcessRow =
  (agreement: GrantAgreement) =>
  ([name, process]: [string, Process]): ProcessRow => {
    const body = bodyOf(process)

    return {
      name,
      type: processTypes[process.type] ?? process.type,
      requestsPayment: name === paymentHandler,
      call: toCall(name, process, agreement),
      sends: toMappingRows(body ?? {}),
      bodyOnGet: body !== undefined && isGet(process),
      outputs: toMappingRows(outputsOf(process)),
      lands: toLands(name, agreement.definition)
    }
  }

const toLoadable = (
  agreement: GrantAgreement,
  context: AgreementContext,
  raw: JsonView
): AgreementTab => {
  const { definition } = agreement
  const states = Object.entries(definition.states).map(
    toStateGroup(definition.create.target)
  )

  return {
    problem: null,
    major: majorOf(context.version),
    paymentHref: context.hrefs.payment,
    facts: toFacts(agreement, context),
    missingServiceUrls: agreement.missingServiceUrls ?? [],
    states,
    pageProcesses: states.some(({ pageProcesses }) => pageProcesses.length),
    pages: toPageOrder(definition).map(toPageRow(definition)),
    createdWith: toMappingRows(definition.create.values ?? {}),
    processes: Object.entries(definition.processDefinitions ?? {}).map(
      toProcessRow(agreement)
    ),
    raw
  }
}

const majorOf = (version: string): string => version.split('.')[0]

export const toAgreementTab = (
  agreement: GrantAgreement,
  context: AgreementContext
): AgreementTab => {
  const raw = toJsonView(agreement.definition)

  return agreement.problem === null
    ? toLoadable(agreement, context, raw)
    : {
        problem: agreement.problem,
        failed: context.fetchStatus === 'permanent_error',
        major: majorOf(context.version),
        version: context.version,
        raw
      }
}
