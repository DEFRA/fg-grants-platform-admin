import type {
  StoredBanner,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import {
  caseViewOf,
  toActionCall,
  toActionHref,
  toBannerButtons,
  toCall,
  toCaseTabs
} from './workflow-external-actions.ts'
import type { ActionCall, CaseTab } from './workflow-external-actions.ts'

/** A stored path: an empty one is shown as such, so it never reads as missing. */
type StoredText = { kind: 'value' | 'empty'; text: string } | { kind: 'none' }

interface SummaryRow {
  key: string
  label: string
  valueFrom: StoredText
  type: string
}

interface CaseTabRow {
  order: number
  key: string
  label: string
  builtIn: boolean
  /** Null when the tab is always shown. */
  shownWhen: string | null
  fires: ActionLink[]
  components: string[]
  customLink: CaseTab['customLink']
}

/** What CW calls for an action, linked to its Integrations card when it is defined. */
type ActionLink = ActionCall & { href: string | null }

export interface WorkflowPagesTab {
  banner: { title: StoredText; buttons: ActionLink[]; summary: SummaryRow[] }
  tabs: CaseTabRow[]
}

const toStoredText = (text: string | undefined): StoredText => {
  if (text === undefined) {
    return { kind: 'none' }
  }

  return text === '' ? { kind: 'empty', text: '""' } : { kind: 'value', text }
}

const toSummary = ({ summary = {} }: StoredBanner = {}): SummaryRow[] =>
  Object.entries(summary).map(([key, { label, text, type, format }]) => ({
    key,
    label,
    valueFrom: toStoredText(text),
    type: format ? `${type} (${format})` : type
  }))

const toActionLink =
  (integrationsHref: string) =>
  (call: ActionCall): ActionLink => ({
    ...call,
    href:
      call.kind === 'not-defined'
        ? null
        : toActionHref(integrationsHref, call.action.code)
  })

const toCaseTabRow =
  (definition: WorkflowDefinition, toLink: (call: ActionCall) => ActionLink) =>
  (
    { key, label, builtIn, renderIf, fires, components, customLink }: CaseTab,
    index: number
  ): CaseTabRow => ({
    order: index + 1,
    key,
    label,
    builtIn,
    shownWhen: renderIf,
    fires: fires.map(({ actionCode }) =>
      toLink(toActionCall(definition, actionCode))
    ),
    components,
    customLink
  })

/** The case view CW builds from this workflow: its banner, then its tabs in order. */
export const toWorkflowPagesTab = (
  definition: WorkflowDefinition,
  integrationsHref: string
): WorkflowPagesTab => {
  const { workflow } = definition
  const { banner } = caseViewOf(workflow)
  const toLink = toActionLink(integrationsHref)

  return {
    banner: {
      title: toStoredText(banner?.title?.text),
      buttons: toBannerButtons(workflow).map((action) =>
        toLink(toCall(definition, action))
      ),
      summary: toSummary(banner)
    },
    tabs: toCaseTabs(workflow).map(toCaseTabRow(definition, toLink))
  }
}
