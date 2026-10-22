import type {
  ServiceAddress,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { none } from './event-formats.ts'
import {
  addressOf,
  endpointCodeOf,
  findExternalAction,
  toActionAnchor,
  toBannerButtons,
  toCall,
  toCaseTabs
} from './workflow-external-actions.ts'
import type { ActionCall } from './workflow-external-actions.ts'

interface Trigger {
  label: string
  href: string
}

interface Call {
  method: string
  endpointCode: string
  address: ServiceAddress
}

interface Send {
  kind: 'PATH' | 'BODY'
  name: string
  expression: string
}

type Write =
  | { kind: 'supplementary'; path: string; detail: string }
  | { kind: 'timeline' }
  | { kind: 'actionData'; path: string }

export interface IntegrationCard {
  code: string
  name: string
  description: string | null
  /** Null on a later action with the same code, which CW never runs. */
  anchor: string | null
  problems: string[]
  triggers: Trigger[]
  call: Call | null
  sends: Send[]
  writes: Write[]
}

export interface WorkflowIntegrations {
  cards: IntegrationCard[]
  unusedEndpoints: { code: string; method: string; address: ServiceAddress }[]
}

/** One entry in a case tab's action map: CW runs the action each time the tab opens. */
interface TabFire {
  label: string
  tabKey: string
  key: string
  actionCode: unknown
}

const sentKinds = new Set(['PATH', 'BODY'])

const toExpression = (expression: unknown): string =>
  typeof expression === 'string' ? expression : JSON.stringify(expression)

const toSends = ({ endpoint }: StoredExternalAction): Send[] =>
  Object.entries(
    (typeof endpoint === 'object' && endpoint?.endpointParams) || {}
  )
    .filter(([kind]) => sentKinds.has(kind))
    .flatMap(([kind, params]) =>
      Object.entries(params).map(([name, expression]) => ({
        kind: kind as Send['kind'],
        name,
        expression: toExpression(expression)
      }))
    )

const toTabFires = (workflow: StoredWorkflow): TabFire[] =>
  toCaseTabs(workflow).flatMap(({ key: tabKey, label, fires }) =>
    fires.map(({ key, actionCode }) => ({ label, tabKey, key, actionCode }))
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
  { onBanner, fires }: Runs,
  pagesHref: string
): Trigger[] => [
  ...(onBanner
    ? [{ label: 'Banner button', href: `${pagesHref}#banner` }]
    : []),
  ...fires.map(({ label, tabKey }) => ({
    label: `Tab: ${label}`,
    href: `${pagesHref}#tab-${encodeURIComponent(tabKey)}`
  }))
]

const toTargetWrites = ({ target }: StoredExternalAction): Write[] =>
  target
    ? [
        {
          kind: 'supplementary',
          path: `supplementaryData.${target.targetNode}`,
          detail: `${target.dataType.toLowerCase()} · ${target.place}`
        }
      ]
    : []

const toTimelineWrites = ({ display }: StoredExternalAction): Write[] =>
  display === true ? [{ kind: 'timeline' }] : []

/** A button writes the action's own effects; a tab keeps the answer under its key, unstored. */
const toWrites = (
  action: StoredExternalAction,
  { onBanner, fires }: Runs
): Write[] => [
  ...(onBanner ? [...toTargetWrites(action), ...toTimelineWrites(action)] : []),
  ...fires.map(
    ({ key }): Write => ({
      kind: 'actionData',
      path: `actionData.${key}`
    })
  )
]

const toCallView = (call: ActionCall): Call | null =>
  call.kind === 'call'
    ? {
        method: call.endpoint.method,
        endpointCode: call.endpoint.code,
        address: call.address
      }
    : null

const toProblems = (
  action: StoredExternalAction,
  call: ActionCall,
  triggers: Trigger[]
): string[] => [
  ...(call.kind === 'call'
    ? []
    : [`Endpoint ${endpointCodeOf(action) ?? none} not defined`]),
  ...(triggers.length ? [] : ['Not triggered: no button, no tab'])
]

/** An action with how CW reaches it and what it calls, each resolved once. */
interface ResolvedAction {
  action: StoredExternalAction
  runs: Runs
  call: ActionCall
}

const toCard =
  (pagesHref: string) =>
  ({ action, runs, call }: ResolvedAction): IntegrationCard => {
    const triggers = toTriggers(runs, pagesHref)

    return {
      code: action.code,
      name: action.name,
      description: action.description ?? null,
      anchor: runs.reachable ? toActionAnchor(action.code) : null,
      problems: toProblems(action, call, triggers),
      triggers,
      call: toCallView(call),
      sends: toSends(action),
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
      .map((endpoint) => ({
        code: endpoint.code,
        method: endpoint.method,
        address: addressOf(definition, endpoint)
      }))
  }
}
