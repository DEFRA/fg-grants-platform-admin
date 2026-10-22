// How CW builds a case view and calls its external actions at runtime, for the Pages and Integrations tabs.
import type {
  ServiceAddress,
  StoredCaseTab,
  StoredCaseView,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'

export const findExternalAction = (
  { externalActions }: StoredWorkflow,
  code: unknown
): StoredExternalAction | null =>
  typeof code === 'string'
    ? (externalActions?.find((action) => action.code === code) ?? null)
    : null

export const endpointCodeOf = ({
  endpoint
}: StoredExternalAction): string | null =>
  typeof endpoint === 'object' && endpoint?.code ? endpoint.code : null

export const findEndpoint = (
  { endpoints }: StoredWorkflow,
  action: StoredExternalAction
): StoredEndpoint | null => {
  const code = endpointCodeOf(action)

  return code === null
    ? null
    : (endpoints?.find((endpoint) => endpoint.code === code) ?? null)
}

export type ActionCall =
  | { kind: 'not-defined'; code: string }
  | { kind: 'no-endpoint'; action: StoredExternalAction }
  | {
      kind: 'call'
      action: StoredExternalAction
      endpoint: StoredEndpoint
      address: ServiceAddress
    }

const toNotDefined = (code: unknown): ActionCall => ({
  kind: 'not-defined',
  code: typeof code === 'string' ? code : JSON.stringify(code)
})

export const addressOf = (
  { workflow, addresses }: WorkflowDefinition,
  endpoint: StoredEndpoint
): ServiceAddress => addresses[(workflow.endpoints ?? []).indexOf(endpoint)]

/** What CW would call for an action code; a code that is not a string is shown as stored. */
export const toActionCall = (
  definition: WorkflowDefinition,
  code: unknown
): ActionCall => {
  const action = findExternalAction(definition.workflow, code)

  return action === null ? toNotDefined(code) : toCall(definition, action)
}

export const toCall = (
  definition: WorkflowDefinition,
  action: StoredExternalAction
): ActionCall => {
  const endpoint = findEndpoint(definition.workflow, action)

  return endpoint === null
    ? { kind: 'no-endpoint', action }
    : {
        kind: 'call',
        action,
        endpoint,
        address: addressOf(definition, endpoint)
      }
}

export const caseViewOf = ({ pages = {} }: StoredWorkflow): StoredCaseView =>
  pages.cases?.details ?? {}

/** CW adds the shown actions to the case banner, and only when there is one. */
export const toBannerButtons = (
  workflow: StoredWorkflow
): StoredExternalAction[] =>
  caseViewOf(workflow).banner
    ? (workflow.externalActions ?? []).filter(({ display }) => display === true)
    : []

export interface CaseTab {
  key: string
  label: string
  builtIn: boolean
  /** Null when the tab is always shown. */
  renderIf: string | null
  /** The tab's action map, in map order. */
  fires: { key: string; actionCode: unknown }[]
  components: string[]
}

interface BuiltInTab {
  key: string
  label: string
  index: number
  /** CW loads the tab through its tab route, which fires its actions. */
  loadsAsTab: boolean
}

const builtInTabs: BuiltInTab[] = [
  { key: 'tasks', label: 'Tasks', index: 0, loadsAsTab: false },
  { key: 'case-details', label: 'Application', index: 1, loadsAsTab: true },
  { key: 'notes', label: 'Notes', index: 4, loadsAsTab: false },
  { key: 'timeline', label: 'Timeline', index: 3, loadsAsTab: false }
]

const builtInKeys = new Set(builtInTabs.map(({ key }) => key))

const idToText = (key: string): string =>
  key
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const toFires = ({ action }: StoredCaseTab = {}): CaseTab['fires'] =>
  Object.entries(action ?? {}).map(([key, actionCode]) => ({
    key,
    actionCode
  }))

const toComponents = ({ content }: StoredCaseTab = {}): string[] =>
  (content ?? []).map(({ component }) => component ?? 'text')

type IndexedTab = CaseTab & { index: number | undefined }

/** A built-in keeps its own label and place; only Application's actions and content count. */
const toBuiltInTab = (
  { key, label, index }: BuiltInTab,
  tab: StoredCaseTab | undefined
): IndexedTab => ({
  key,
  label,
  index,
  builtIn: true,
  renderIf: null,
  fires: toFires(tab),
  components: toComponents(tab)
})

const toLink = (
  key: string,
  { text, index }: NonNullable<StoredCaseTab['link']>
): Pick<IndexedTab, 'label' | 'index'> => ({
  label: text || idToText(key),
  index
})

const toDefinitionTab = (
  key: string,
  { link, renderIf, ...tab }: StoredCaseTab
): IndexedTab => ({
  key,
  ...toLink(key, link ?? {}),
  builtIn: false,
  renderIf: renderIf ?? null,
  fires: toFires(tab),
  components: toComponents(tab)
})

/** CW's own comparator: a tab with no index goes last, ties keep their order. */
const sortIndexOf = ({ index }: IndexedTab): number =>
  index ?? Number.MAX_SAFE_INTEGER

export const toCaseTabs = (workflow: StoredWorkflow): CaseTab[] => {
  const { tabs = {} } = caseViewOf(workflow)

  const builtIns = builtInTabs.map((builtIn) =>
    toBuiltInTab(builtIn, builtIn.loadsAsTab ? tabs[builtIn.key] : {})
  )

  const definitionTabs = Object.entries(tabs)
    .filter(([key]) => !builtInKeys.has(key))
    .map(([key, tab]) => toDefinitionTab(key, tab))

  return [...builtIns, ...definitionTabs]
    .sort((a, b) => sortIndexOf(a) - sortIndexOf(b))
    .map(({ index: _index, ...tab }) => tab)
}

export const toActionAnchor = (code: string): string => `action-${code}`

export const toActionHref = (integrationsHref: string, code: string): string =>
  `${integrationsHref}#${encodeURIComponent(toActionAnchor(code))}`
