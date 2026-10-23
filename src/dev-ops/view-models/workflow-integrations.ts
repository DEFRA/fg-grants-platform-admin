import type {
  ServiceAddress,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { none } from './event-formats.ts'
import {
  addressOf,
  endpointCodeOf,
  findExternalAction,
  literalOf,
  sourceOfText,
  toActionAnchor,
  toBannerButtons,
  toCall,
  toCaseTabs
} from './workflow-external-actions.ts'
import type { ActionCall, CaseTab } from './workflow-external-actions.ts'

/** Who runs the action in the case view, linked to where Pages shows it. */
interface Trigger {
  kind: 'button' | 'tab'
  label: string
  href: string
  customLink: CaseTab['customLink']
}

interface Call {
  method: string
  path: string
  endpointCode: string
  address: ServiceAddress
}

/** A literal is sent as written; a `$.` or `@.` ref, alone or among words, is read from the case; a `jsonata:` expression is computed. */
interface Send {
  kind: 'PATH' | 'BODY' | 'HEADER'
  name: string
  source: 'fixed' | 'case' | 'computed'
  text: string
}

/** How CW keeps the answer under a target: appended, or replacing what has the same key. */
type TargetShape = 'list' | 'list-keyed' | 'object-keyed' | 'object-unkeyed'

type Write =
  | {
      kind: 'target'
      path: string
      shape: TargetShape
      key: string | null
      /** No button runs it, so it writes only when something else does. */
      whenRun: boolean
    }
  | { kind: 'timeline' }
  | { kind: 'actionData'; path: string; tabs: string[] }

/** What the action writes when one trigger runs it; no trigger named when only one kind runs it. */
interface WriteGroup {
  trigger: 'pressed' | 'tab' | null
  writes: Write[]
}

export interface IntegrationCard {
  code: string
  name: string
  description: string | null
  /** Null on a later action with the same code, which CW never runs. */
  anchor: string | null
  problems: string[]
  /** Nothing in the case view runs it, though CW's page-action API still can. */
  apiOnly: boolean
  triggers: Trigger[]
  call: Call | null
  sends: Send[]
  /** The service whose `{SERVICE}_HEADERS` replace same-named headers, when the action sends any. */
  headersService: string | null
  writes: WriteGroup[]
}

export interface WorkflowIntegrations {
  cards: IntegrationCard[]
  unusedEndpoints: Call[]
}

/** One entry in a case tab's action map: CW runs the action each time the tab opens. */
interface TabFire {
  label: string
  tabKey: string
  key: string
  actionCode: unknown
  customLink: CaseTab['customLink']
}

/** The parameter kinds CW's resolver sends, as each is named on a row. */
const sentKinds = new Map<string, Send['kind']>([
  ['PATH', 'PATH'],
  ['BODY', 'BODY'],
  ['HEADERS', 'HEADER']
])

const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value]
  }

  return typeof value === 'object' && value !== null
    ? Object.values(value).flatMap(stringsIn)
    : []
}

/** CW resolves each string inside a list or object as it would on its own. */
const toSource = (value: unknown): Send['source'] => {
  if (typeof value === 'string') {
    return sourceOfText(value)
  }

  return stringsIn(value).some((text) => sourceOfText(text) !== 'fixed')
    ? 'case'
    : 'fixed'
}

const toSendText = (value: unknown, source: Send['source']): string => {
  if (typeof value !== 'string') {
    return JSON.stringify(value)
  }

  return source === 'fixed' ? JSON.stringify(literalOf(value)) : value
}

const toSend =
  (kind: Send['kind']) =>
  ([name, value]: [string, unknown]): Send => {
    const source = toSource(value)

    return {
      kind,
      name,
      source,
      text: toSendText(value, source)
    }
  }

const toSends = ({ endpoint }: StoredExternalAction): Send[] =>
  Object.entries(
    (typeof endpoint === 'object' && endpoint?.endpointParams) || {}
  ).flatMap(([kind, params]) => {
    const sent = sentKinds.get(kind)

    return sent ? Object.entries(params).map(toSend(sent)) : []
  })

const toTabFires = (workflow: StoredWorkflow): TabFire[] =>
  toCaseTabs(workflow).flatMap(({ key: tabKey, label, fires, customLink }) =>
    fires.map(({ key, actionCode }) => ({
      label,
      tabKey,
      key,
      actionCode,
      customLink
    }))
  )

/** How CW reaches an action: only the first action with a code ever runs. */
interface Runs {
  reachable: boolean
  onBanner: boolean
  fires: TabFire[]
}

const isReachable = (
  workflow: StoredWorkflow,
  action: StoredExternalAction
): boolean => findExternalAction(workflow, action.code) === action

const toRuns = (
  workflow: StoredWorkflow,
  action: StoredExternalAction
): Runs => {
  if (!isReachable(workflow, action)) {
    return { reachable: false, onBanner: false, fires: [] }
  }

  return {
    reachable: true,
    onBanner: toBannerButtons(workflow).some(
      ({ code }) => code === action.code
    ),
    fires: toTabFires(workflow).filter(
      ({ actionCode }) => actionCode === action.code
    )
  }
}

const toTriggers = (
  action: StoredExternalAction,
  { onBanner, fires }: Runs,
  pagesHref: string
): Trigger[] => [
  ...(onBanner
    ? [
        {
          kind: 'button' as const,
          label: action.name,
          href: `${pagesHref}#banner`,
          customLink: null
        }
      ]
    : []),
  ...fires.map(({ label, tabKey, customLink }) => ({
    kind: 'tab' as const,
    label,
    href: `${pagesHref}#tab-${encodeURIComponent(tabKey)}`,
    customLink
  }))
]

const toShape = (
  dataType: 'ARRAY' | 'OBJECT',
  key: string | null
): TargetShape => {
  if (dataType === 'OBJECT') {
    return key ? 'object-keyed' : 'object-unkeyed'
  }

  return key ? 'list-keyed' : 'list'
}

const toTargetWrites = (
  { target }: StoredExternalAction,
  { onBanner }: Runs
): Write[] =>
  target
    ? [
        {
          kind: 'target',
          path: `supplementaryData.${target.targetNode}`,
          shape: toShape(target.dataType, target.key ?? null),
          key: target.key ?? null,
          whenRun: !onBanner
        }
      ]
    : []

const toTimelineWrites = ({ display }: StoredExternalAction): Write[] =>
  display === true ? [{ kind: 'timeline' }] : []

/** One row per key a tab keeps the answer under, naming every tab that does. */
const toActionDataWrites = (fires: TabFire[]): Write[] =>
  [...Map.groupBy(fires, ({ key }) => key)].map(([key, tabFires]) => ({
    kind: 'actionData',
    path: `actionData.${key}`,
    tabs: [...new Set(tabFires.map(({ label }) => label))]
  }))

/** The action's own effects when pressed; a tab keeps the answer under its key, unstored. A button and a tab say which is which. */
const toWrites = (action: StoredExternalAction, runs: Runs): WriteGroup[] => {
  if (!runs.reachable) {
    return []
  }

  const own = [...toTargetWrites(action, runs), ...toTimelineWrites(action)]
  const shown = toActionDataWrites(runs.fires)

  return runs.onBanner && shown.length
    ? [
        { trigger: 'pressed', writes: own },
        { trigger: 'tab', writes: shown }
      ]
    : [{ trigger: null, writes: [...own, ...shown] }].filter(
        ({ writes }) => writes.length
      )
}

const toEndpointCall = (
  endpoint: StoredEndpoint,
  address: ServiceAddress
): Call => ({
  method: endpoint.method,
  path: endpoint.path,
  endpointCode: endpoint.code,
  address
})

const toCallView = (call: ActionCall): Call | null =>
  call.kind === 'call' ? toEndpointCall(call.endpoint, call.address) : null

const toProblems = (
  action: StoredExternalAction,
  call: ActionCall,
  { reachable }: Runs
): string[] => [
  ...(call.kind === 'call'
    ? []
    : [`Endpoint ${endpointCodeOf(action) ?? none} not defined`]),
  ...(reachable
    ? []
    : [
        `CW runs only the first action with code ${action.code}, so this one never runs`
      ])
]

const toHeadersService = (sends: Send[], call: Call | null): string | null =>
  call && sends.some(({ kind }) => kind === 'HEADER')
    ? call.address.service
    : null

/** An action with how CW reaches it and what it calls, each resolved once. */
interface ResolvedAction {
  action: StoredExternalAction
  runs: Runs
  call: ActionCall
}

const toCard =
  (pagesHref: string) =>
  ({ action, runs, call: actionCall }: ResolvedAction): IntegrationCard => {
    const triggers = toTriggers(action, runs, pagesHref)
    const call = toCallView(actionCall)
    const sends = toSends(action)

    return {
      code: action.code,
      name: action.name,
      description: action.description ?? null,
      anchor: runs.reachable ? toActionAnchor(action.code) : null,
      problems: toProblems(action, actionCall, runs),
      apiOnly: runs.reachable && triggers.length === 0,
      triggers,
      call,
      sends,
      headersService: toHeadersService(sends, call),
      writes: toWrites(action, runs)
    }
  }

/** Every external action as CW runs it: what triggers it, what it calls and sends, and what it writes. */
export const toWorkflowIntegrations = (
  definition: WorkflowDefinition,
  pagesHref: string
): WorkflowIntegrations => {
  const { workflow } = definition
  const resolved = (workflow.externalActions ?? []).map((action) => ({
    action,
    runs: toRuns(workflow, action),
    call: toCall(definition, action)
  }))
  const used = new Set(
    resolved.flatMap(({ runs, call }) =>
      runs.reachable && call.kind === 'call' ? [call.endpoint] : []
    )
  )

  return {
    cards: resolved.map(toCard(pagesHref)),
    unusedEndpoints: (workflow.endpoints ?? [])
      .filter((endpoint) => !used.has(endpoint))
      .map((endpoint) =>
        toEndpointCall(endpoint, addressOf(definition, endpoint))
      )
  }
}
