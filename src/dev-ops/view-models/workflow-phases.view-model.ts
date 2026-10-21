import type { BadgeRole } from '../use-cases/get-event.use-case.ts'
import type {
  ExternalStatusMapping,
  GrantLifecycle,
  GrantStatusMap,
  StoredAction,
  StoredTransition,
  StoredWorkflowPhase,
  StoredWorkflowStage,
  StoredWorkflowStatus
} from '../use-cases/get-workflow-page.use-case.ts'
import { toStateGraphs } from './state-graph.view-model.ts'
import type {
  MoveKind,
  StateGraphs,
  StateMap,
  StateMove
} from './state-graph.view-model.ts'
import { toThemeRole } from './workflow-theme.ts'

interface LegendItem {
  kind: MoveKind | 'flagged' | 'other-phase'
  label: string
}

/** Text with no link is shown as mono text. */
interface PositionLink {
  text: string
  href: string | null
}

type Flag = 'tasks read-only' | 'closes case' | 'hides tasks'

type TellsGas =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'not-mapped' }
  | { kind: 'mapped'; lines: { keyedOn: string; to: PositionLink }[] }

export interface WorkflowStatusPanel {
  code: string
  name: string
  role: BadgeRole | null
  flags: Flag[]
  phase: { code: string; name: string }
  stage: { code: string; name: string }
  findings: string[]
  waysIn: {
    from: PositionLink
    via: { kind: 'action'; code: string } | { kind: 'gas' }
  }[]
  waysOut: {
    to: PositionLink
    move:
      | { kind: 'action'; name: string; code: string; badges: string[] }
      | { kind: 'gas'; badges: string[] }
  }[]
  closes: boolean
  tellsGas: TellsGas
}

export interface WorkflowPhasesTab {
  graphs: StateGraphs
  legend: LegendItem[]
  panel: WorkflowStatusPanel | null
}

interface WorkflowPhasesLinks {
  /** This tab with the position selected. */
  status: (position: string) => string
  /** The grant's Phases tab with the GAS position selected. */
  grantStatus: (position: string) => string
}

interface Move {
  from: string
  transition: StoredTransition
}

interface Place {
  position: string
  phase: StoredWorkflowPhase
  stage: StoredWorkflowStage
  status: StoredWorkflowStatus
  in: Move[]
  findings: string[]
}

const positionOf = (...codes: string[]) => codes.join(':')

const stageOf = (position: string) => position.split(':').slice(0, 2).join(':')

const phaseOf = (position: string) => position.split(':')[0]

/** The bare status code inside `from`'s stage, the full position anywhere else. */
const shortPosition = (position: string, from: string) =>
  stageOf(position) === stageOf(from) ? position.split(':')[2] : position

/** As GAS words a target: the status in the keyed stage, stage and status in the keyed phase. */
const shortGasPosition = (position: string, keyedOn: string) => {
  if (stageOf(position) === keyedOn) {
    return position.split(':')[2]
  }

  return phaseOf(position) === phaseOf(keyedOn)
    ? position.split(':').slice(1).join(':')
    : position
}

const flattenPlaces = (phases: StoredWorkflowPhase[]) =>
  phases.flatMap((phase) =>
    phase.stages.flatMap((stage) =>
      stage.statuses.map((status) => ({
        position: positionOf(phase.code, stage.code, status.code),
        phase,
        stage,
        status
      }))
    )
  )

/** CW starts a case at the first status of the first stage of the first phase, if there is one. */
const initialOf = ([phase]: StoredWorkflowPhase[]) => {
  const status = phase?.stages[0]?.statuses[0]

  return status && positionOf(phase.code, phase.stages[0].code, status.code)
}

const isUnreached = ({ position, in: waysIn }: Place, initial?: string) =>
  position !== initial && waysIn.length === 0

const isStuck = ({ transitions, closes }: StoredWorkflowStatus) =>
  transitions.length === 0 && closes !== true

const findingsOf = (place: Place, initial: string | undefined) => [
  ...(isUnreached(place, initial) ? ['No ways in'] : []),
  ...(isStuck(place.status) ? ['No ways out and does not close the case'] : [])
]

/** One place per position, the first copy of a duplicate, as CW's lookups take it. */
const indexPlaces = (phases: StoredWorkflowPhase[]) => {
  const index = new Map<string, Place>()

  flattenPlaces(phases)
    .filter(
      ({ position }, i, all) =>
        all.findIndex((other) => other.position === position) === i
    )
    .forEach((place) =>
      index.set(place.position, { ...place, in: [], findings: [] })
    )
  index.forEach(({ position, status }) =>
    status.transitions.forEach((transition) =>
      index
        .get(transition.targetPosition)
        ?.in.push({ from: position, transition })
    )
  )
  const initial = initialOf(phases)

  index.forEach((place) => {
    place.findings = findingsOf(place, initial)
  })

  return index
}

const toMove = (
  from: string,
  { targetPosition, action }: StoredTransition
): StateMove => ({
  from,
  to: targetPosition,
  kind: action ? 'plain' : 'dashed',
  title: action ? `${action.name} (${action.code})` : 'GAS sends'
})

const toStateMap = (
  phases: StoredWorkflowPhase[],
  index: Map<string, Place>
): StateMap => ({
  phases: phases.map((phase) => ({
    code: phase.code,
    name: phase.name,
    stages: phase.stages.map((stage) => ({
      code: stage.code,
      name: stage.name,
      statuses: stage.statuses.map(({ code, theme }) => ({
        code,
        tone: toThemeRole(theme) ?? 'neutral',
        flagged:
          (index.get(positionOf(phase.code, stage.code, code))?.findings
            .length ?? 0) > 0
      }))
    }))
  })),
  moves: [...index.values()].flatMap(({ position, status }) =>
    status.transitions
      .filter(({ targetPosition }) => index.has(targetPosition))
      .map((transition) => toMove(position, transition))
  )
})

const toLegend = (index: Map<string, Place>): LegendItem[] => [
  { kind: 'plain', label: 'Action' },
  { kind: 'dashed', label: 'GAS sends' },
  ...([...index.values()].some(({ findings }) => findings.length)
    ? [{ kind: 'flagged' as const, label: 'Finding' }]
    : []),
  { kind: 'other-phase', label: 'Other phase' }
]

const toFlags = ({
  interactive,
  closes,
  hideTaskGroups
}: StoredWorkflowStatus): Flag[] => [
  ...(interactive ? [] : (['tasks read-only'] as const)),
  ...(closes === true ? (['closes case'] as const) : []),
  ...(hideTaskGroups ? (['hides tasks'] as const) : [])
]

const commentBadges = (comment: { mandatory: boolean } | null) => {
  if (!comment) {
    return []
  }

  return [comment.mandatory ? 'comment required' : 'comment']
}

const actionBadges = ({ checkTasks, comment, confirm }: StoredAction) => [
  ...(checkTasks ? ['tasks done'] : []),
  ...commentBadges(comment),
  ...(confirm ? ['confirm'] : [])
]

const toWayOutMove = ({
  action,
  checkTasks
}: StoredTransition): WorkflowStatusPanel['waysOut'][number]['move'] =>
  action
    ? {
        kind: 'action',
        name: action.name,
        code: action.code,
        badges: actionBadges(action)
      }
    : { kind: 'gas', badges: checkTasks ? ['tasks done'] : [] }

const grantTexts: Record<
  Exclude<GrantStatusMap['outcome'], 'found'>,
  string
> = {
  'no-grant': 'No grant',
  'not-stored': 'Grant definition not stored',
  unreadable: 'Grant definition cannot be read',
  unavailable: 'Grant could not be read from fg-gas-backend',
  'timed-out': 'Grant could not be read from fg-gas-backend'
}

const positionsOf = ({ phases }: GrantLifecycle) =>
  new Set(
    phases.flatMap((phase) =>
      phase.stages.flatMap((stage) =>
        stage.statuses.map(({ code }) =>
          positionOf(phase.code, stage.code, code)
        )
      )
    )
  )

const toGasTarget = (
  { whileIn, mappedTo, to }: ExternalStatusMapping,
  onMap: Set<string>,
  grantStatus: WorkflowPhasesLinks['grantStatus']
): PositionLink => {
  if (to === null) {
    return { text: mappedTo, href: null }
  }

  return {
    text: shortGasPosition(to, whileIn),
    href: onMap.has(to) ? grantStatus(to) : null
  }
}

const toMappedLines = (
  lifecycle: GrantLifecycle,
  position: string,
  grantStatus: WorkflowPhasesLinks['grantStatus']
): TellsGas => {
  const onMap = positionsOf(lifecycle)
  const lines = lifecycle.externalMappings
    .filter(({ source, code }) => source === 'CW' && code === position)
    .map((mapping) => ({
      keyedOn: mapping.whileIn,
      to: toGasTarget(mapping, onMap, grantStatus)
    }))

  return lines.length ? { kind: 'mapped', lines } : { kind: 'not-mapped' }
}

/** What GAS does with the `CaseStatusUpdated` CW sends on reaching the status, which only an action does. */
const toTellsGas = (
  place: Place,
  grant: GrantStatusMap,
  grantStatus: WorkflowPhasesLinks['grantStatus']
): TellsGas => {
  if (place.in.length === 0) {
    return { kind: 'none' }
  }

  if (!place.in.some(({ transition }) => transition.action)) {
    return { kind: 'text', text: 'Not sent (GAS moves only)' }
  }

  return grant.outcome === 'found'
    ? toMappedLines(grant.lifecycle, place.position, grantStatus)
    : { kind: 'text', text: grantTexts[grant.outcome] }
}

const toPanel = (
  place: Place,
  index: Map<string, Place>,
  grant: GrantStatusMap,
  links: WorkflowPhasesLinks
): WorkflowStatusPanel => {
  const { position, phase, stage, status } = place
  const linkTo = (target: string): PositionLink =>
    index.has(target)
      ? { text: shortPosition(target, position), href: links.status(target) }
      : { text: target, href: null }

  return {
    code: status.code,
    name: status.name,
    role: toThemeRole(status.theme),
    flags: toFlags(status),
    phase: { code: phase.code, name: phase.name },
    stage: { code: stage.code, name: stage.name },
    findings: place.findings,
    waysIn: place.in.map(({ from, transition: { action } }) => ({
      from: linkTo(from),
      via: action ? { kind: 'action', code: action.code } : { kind: 'gas' }
    })),
    waysOut: status.transitions.map((transition) => ({
      to: linkTo(transition.targetPosition),
      move: toWayOutMove(transition)
    })),
    closes: status.closes === true,
    tellsGas: toTellsGas(place, grant, links.grantStatus)
  }
}

/**
 * The workflow's state graphs, with a finding on each status no transition
 * reaches or no transition leaves, and the selected status's panel. Targets
 * are matched literally, as CW matches them; one that is not on the map is
 * listed but not drawn.
 */
export const toWorkflowPhases = (
  phases: StoredWorkflowPhase[],
  grant: GrantStatusMap,
  asked: string | undefined,
  links: WorkflowPhasesLinks
): WorkflowPhasesTab => {
  const index = indexPlaces(phases)
  const graphs = toStateGraphs(toStateMap(phases, index), asked, links.status)
  const selected = graphs.selected && index.get(graphs.selected.position)

  return {
    graphs,
    legend: toLegend(index),
    panel: selected ? toPanel(selected, index, grant, links) : null
  }
}
