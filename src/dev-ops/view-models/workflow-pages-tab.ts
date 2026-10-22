import type {
  StoredBanner,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { none } from './event-formats.ts'
import {
  caseViewOf,
  toActionCall,
  toBannerButtons,
  toCall,
  toCaseTabs
} from './workflow-external-actions.ts'
import type { ActionCall, CaseTab } from './workflow-external-actions.ts'

/** A stored path: an empty one is shown as such, so it never reads as missing. */
interface StoredText {
  kind: 'value' | 'empty' | 'none'
  text: string
}

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
  fires: ActionCall[]
  components: string[]
}

export interface WorkflowPagesTab {
  banner: { title: StoredText; buttons: ActionCall[]; summary: SummaryRow[] }
  tabs: CaseTabRow[]
}

const toStoredText = (text: string | undefined): StoredText => {
  if (text === undefined) {
    return { kind: 'none', text: none }
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

const toCaseTabRow =
  (definition: WorkflowDefinition) =>
  (
    { key, label, builtIn, renderIf, fires, components }: CaseTab,
    index: number
  ): CaseTabRow => ({
    order: index + 1,
    key,
    label,
    builtIn,
    shownWhen: renderIf,
    fires: fires.map(({ actionCode }) => toActionCall(definition, actionCode)),
    components
  })

/** The case view CW builds from this workflow: its banner, then its tabs in order. */
export const toWorkflowPagesTab = (
  definition: WorkflowDefinition
): WorkflowPagesTab => {
  const { workflow } = definition
  const { banner } = caseViewOf(workflow)

  return {
    banner: {
      title: toStoredText(banner?.title?.text),
      buttons: toBannerButtons(workflow).map((action) =>
        toCall(definition, action)
      ),
      summary: toSummary(banner)
    },
    tabs: toCaseTabs(workflow).map(toCaseTabRow(definition))
  }
}
