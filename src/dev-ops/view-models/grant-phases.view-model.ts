import type {
  ExternalStatusMapping,
  GrantLifecycle,
  WayIn
} from '../use-cases/get-grant-page.use-case.ts'
import { toTabHref } from './record-page.view-model.ts'
import { toStateGraphs } from './state-graph.view-model.ts'
import type {
  MoveKind,
  StateGraphs,
  StateMap,
  StateMove
} from './state-graph.view-model.ts'

type Move = Extract<WayIn, { kind: 'move' }>

interface LegendItem {
  kind: MoveKind | 'other-phase'
  label: string
}

type ReachedFrom = { processes: string[] } & (
  | { kind: 'link'; text: string; href: string }
  | { kind: 'code'; text: string }
  | { kind: 'any' }
)

type SetBy =
  | { kind: 'last-claim'; from: string }
  | { kind: 'external'; label: string; href: string | null; whileIn: string }

interface CodeAndName {
  code: string
  name: string | null
}

export interface StatusPanel {
  code: string
  badges: ('initial' | 'amendable')[]
  phase: CodeAndName
  stage: CodeAndName
  reachedFrom: ReachedFrom[]
  movesTo: { text: string; href: string; processes: string[] }[]
  setBy: SetBy[]
}

export type GrantPhasesTab =
  | {
      kind: 'graph'
      graphs: StateGraphs
      legend: LegendItem[]
      panel: StatusPanel | null
    }
  | { kind: 'unreadable'; problem: string }

interface GrantPhasesOptions {
  /** The `status` query value. */
  status: string | undefined
  /** The version's own page. */
  href: string
  from: string
  /** Null while CW statuses have nowhere to link to. */
  workflowHref: ((cwStatus: string, back: string) => string) | null
}

const legend: LegendItem[] = [
  { kind: 'strong', label: 'Runs processes' },
  { kind: 'plain', label: 'No processes' },
  { kind: 'other-phase', label: 'Other phase' }
]

const isMove = (wayIn: WayIn): wayIn is Move => wayIn.kind === 'move'

const toMove = ({ from, to, processes }: Move): StateMove => ({
  from,
  to,
  kind: processes.length ? 'strong' : 'plain',
  title: processes.length
    ? `${from} → ${to}: ${processes.join(', ')}`
    : `${from} → ${to}`
})

const toStateMap = ({ phases, waysIn }: GrantLifecycle): StateMap => ({
  phases: phases.map((phase) => ({
    ...phase,
    stages: phase.stages.map((stage) => ({
      ...stage,
      statuses: stage.statuses.map(({ code }) => ({
        code,
        tone: null,
        flagged: false
      }))
    }))
  })),
  moves: waysIn.filter(isMove).map(toMove)
})

const stageOf = (position: string) => position.split(':').slice(0, 2).join(':')

/** The bare status code inside the selected status's stage, the full position anywhere else. */
const toShortPosition = (position: string, selected: string) =>
  stageOf(position) === stageOf(selected) ? position.split(':')[2] : position

const sourceLabels = new Map([['AS', 'Agreements']])

const toBadges = (
  { initialPosition, amendablePositions }: GrantLifecycle,
  position: string
): StatusPanel['badges'] => [
  ...(position === initialPosition ? (['initial'] as const) : []),
  ...(amendablePositions.includes(position) ? (['amendable'] as const) : [])
]

const toReachedFrom =
  (selected: string, hrefOf: (position: string) => string) =>
  (wayIn: WayIn): ReachedFrom => {
    if (wayIn.kind === 'move') {
      const { from, processes } = wayIn

      return {
        kind: 'link',
        text: toShortPosition(from, selected),
        href: hrefOf(from),
        processes
      }
    }

    return wayIn.kind === 'unmatched'
      ? { kind: 'code', text: wayIn.code, processes: wayIn.processes }
      : { kind: 'any', processes: wayIn.processes }
  }

/** @param back Where a link to the workflow comes back to. */
const toExternal =
  (back: string, workflowHref: GrantPhasesOptions['workflowHref']) =>
  ({ source, code, whileIn }: ExternalStatusMapping): SetBy => ({
    kind: 'external',
    label: `${sourceLabels.get(source) ?? source} ${code}`,
    href: source === 'CW' && workflowHref ? workflowHref(code, back) : null,
    whileIn
  })

const toPanel = (
  lifecycle: GrantLifecycle,
  { position, phase, stage, status }: NonNullable<StateGraphs['selected']>,
  hrefOf: (position: string) => string,
  workflowHref: GrantPhasesOptions['workflowHref']
): StatusPanel => {
  const { claimApproval } = lifecycle

  return {
    code: status.code,
    badges: toBadges(lifecycle, position),
    phase: { code: phase.code, name: phase.name },
    stage: { code: stage.code, name: stage.name },
    reachedFrom: lifecycle.waysIn
      .filter(({ to }) => to === position)
      .map(toReachedFrom(position, hrefOf)),
    movesTo: lifecycle.waysIn
      .filter(isMove)
      .filter(({ from }) => from === position)
      .map(({ to, processes }) => ({
        text: toShortPosition(to, position),
        href: hrefOf(to),
        processes
      })),
    setBy: [
      ...(claimApproval?.to === position
        ? [{ kind: 'last-claim' as const, from: claimApproval.from }]
        : []),
      ...lifecycle.externalMappings
        .filter(({ to }) => to === position)
        .map(toExternal(hrefOf(position), workflowHref))
    ]
  }
}

/** The grant's state graphs and the selected status's panel; null when GAS sent neither, as for a grant not stored. */
export const toGrantPhases = (
  {
    lifecycle,
    problem
  }: { lifecycle?: GrantLifecycle | null; problem?: string | null },
  { status, href, from, workflowHref }: GrantPhasesOptions
): GrantPhasesTab | null => {
  if (typeof problem === 'string') {
    return { kind: 'unreadable', problem }
  }

  if (!lifecycle) {
    return null
  }

  const hrefOf = (position: string) =>
    toTabHref(href, 'phases', from, { status: position })
  const graphs = toStateGraphs(toStateMap(lifecycle), status, hrefOf)

  return {
    kind: 'graph',
    graphs,
    legend,
    panel:
      graphs.selected &&
      toPanel(lifecycle, graphs.selected, hrefOf, workflowHref)
  }
}
