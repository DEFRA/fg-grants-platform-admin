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
import {
  effectsOf,
  knowsEffects,
  toPanelBadges,
  toStatusRef,
  toStatusSetters,
  waysFrom
} from './lifecycle-effects.ts'
import type {
  GasEffect,
  PanelBadge,
  StatusRef,
  StatusSetter
} from './lifecycle-effects.ts'
import {
  sourceLabel,
  stageCodeOf,
  stageKeyOf,
  toLifecycleNames
} from './lifecycle-names.ts'
import type { LifecycleNames } from './lifecycle-names.ts'
import { firstByPosition, toStateGraphs } from './state-graph.view-model.ts'
import type {
  MoveKind,
  StateGraphs,
  StateMap,
  StateMove
} from './state-graph.view-model.ts'
import { toThemeRole } from './workflow-theme.ts'
import { checksTasks } from './workflow-transitions.ts'

interface LegendItem {
  kind: MoveKind | 'flagged' | 'other-phase' | 'start' | 'colour'
  label: string
}

type FlagName = 'start' | 'tasks read-only' | 'closes case' | 'hides tasks'

/** GAS's status and what it may send next, named as the grant names them. */
interface GasStatus {
  name: string
  position: string
}

/** What makes GAS send its next message: the move CW's message made, another service's message, or the last claim. */
type SendTrigger =
  | { kind: 'move' }
  | { kind: 'sends'; source: string; code: string }
  | { kind: 'claim' }

type Finding =
  | { kind: 'dead end' | 'unreachable' }
  | {
      kind: 'mismatch'
      version: string
      at: GasStatus
      sends: GasStatus
      when: SendTrigger
    }

/** A message GAS sends only under a condition GPA cannot check at the status, said quietly rather than as a finding. */
interface MaySend {
  onlyWhen: string
  sends: GasStatus
}

/** Why a move waits for the stage's tasks, or that it never does. */
type TasksNote =
  | { kind: 'needs-tasks'; stageName: string; href: string }
  | { kind: 'gas-blocked'; stageName: string; href: string }
  | { kind: 'none-in-stage' }

interface TellsGasLine {
  stage: { code: string; name: string }
  phase: { code: string; name: string }
  mappedTo: string
  /** Null when GAS cannot read `mappedTo`, so it ignores the message. */
  to: { name: string; position: string; href: string | null } | null
}

type TellsGas =
  | { kind: 'none' }
  | {
      kind: 'text'
      text: 'start' | 'gas-only' | Exclude<GrantStatusMap['outcome'], 'found'>
    }
  | { kind: 'not-stored'; version: string; href: string }
  | { kind: 'ignored' }
  | { kind: 'mapped'; lines: TellsGasLine[] }

export interface WorkflowStatusPanel {
  code: string
  name: string
  role: BadgeRole | null
  flags: PanelBadge<FlagName>[]
  phase: { code: string; name: string }
  stage: { code: string; name: string }
  findings: Finding[]
  maySend: MaySend[]
  startsHere: boolean
  /** Left out for an unreachable status: its finding says there are none. */
  waysIn:
    | {
        from: StatusRef
        via: { kind: 'action'; name: string; code: string } | { kind: 'gas' }
      }[]
    | null
  waysOut: {
    to: StatusRef
    move:
      | { kind: 'action'; name: string; code: string; badges: string[] }
      | { kind: 'gas' }
    tasks: TasksNote | null
  }[]
  closes: boolean
  tellsGas: TellsGas
}

interface FindingsSummary {
  count: number
  groups: {
    kind: Finding['kind']
    statuses: { code: string; href: string }[]
  }[]
}

export interface WorkflowPhasesTab {
  graphs: StateGraphs
  legend: LegendItem[]
  /** Null when nothing is found: it never says the workflow and grant agree. */
  findings: FindingsSummary | null
  panel: WorkflowStatusPanel | null
}

interface WorkflowPhasesLinks {
  /** This tab with the position selected. */
  status: (position: string) => string
  /** The grant's Phases tab with the GAS position selected, coming back to this tab's `selected` status. */
  grantStatus: (position: string, selected: string) => string
  /** The grant version's own page, where its definition is fetched, coming back to this tab's `selected` status. */
  grant: (selected: string) => string
  /** The Tasks tab at the stage's task groups; stage codes repeat across phases. */
  tasks: (phase: string, stage: string) => string
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
  findings: Finding[]
  maySend: MaySend[]
}

const deadLettersHref = '/dev-ops/events/cw/inbox?status=DEAD_LETTER'

const flagTitles: Record<FlagName, string> = {
  start: 'New cases start here',
  'tasks read-only':
    "Caseworkers can't change tasks in this status (interactive: false)",
  'hides tasks': 'The case page hides the task list in this status',
  'closes case': 'CW marks the case closed here'
}

const positionOf = (...codes: string[]) => codes.join(':')

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

const findingsOf = (place: Place, initial: string | undefined): Finding[] => [
  ...(isStuck(place.status) ? [{ kind: 'dead end' as const }] : []),
  ...(isUnreached(place, initial) ? [{ kind: 'unreachable' as const }] : [])
]

/** One place per position, the first copy of a duplicate, as CW's lookups take it. */
const indexPlaces = (phases: StoredWorkflowPhase[]) => {
  const index = new Map<string, Place>()

  firstByPosition(flattenPlaces(phases)).forEach((place, position) =>
    index.set(position, { ...place, in: [], findings: [], maySend: [] })
  )
  index.forEach(({ position, status }) =>
    status.transitions.forEach((transition) =>
      index
        .get(transition.targetPosition)
        ?.in.push({ from: position, transition })
    )
  )

  return index
}

const hasActionIn = ({ in: waysIn }: Place) =>
  waysIn.some(({ transition }) => transition.action)

const cwMappingsOf = (lifecycle: GrantLifecycle, position: string) =>
  lifecycle.externalMappings.filter(
    ({ source, code }) => source === 'CW' && code === position
  )

/** One message GAS may send CW once it is at `at`, and what makes it send it. */
interface NextSend {
  at: string
  sends: string
  when: SendTrigger
  onlyWhen: string | null
}

/** Where CW's message from a status puts GAS: the target, and the stage GAS must be in for it. */
interface GasPosition {
  whileIn: string
  to: string
}

/** What a way's processes tell CW: the status a process sets, else the way's own target. */
const sentBy = (effects: GasEffect[]) =>
  effects
    .filter(({ tellsCw }) => tellsCw)
    .map(({ sets, on, onlyWhen }) => ({ sends: sets ?? on, onlyWhen }))

/** (a) The ways into `at` that CW's own message takes from a status in `whileIn`, when they tell CW. */
const intoSends = (
  lifecycle: GrantLifecycle,
  { whileIn, to: at }: GasPosition
): NextSend[] =>
  waysFrom(lifecycle, (from) => stageKeyOf(from) === whileIn, at)
    .flatMap((wayIn) => sentBy(effectsOf(wayIn)))
    .map((sent) => ({ ...sent, at, when: { kind: 'move' } }))

const isOtherMessageAt = (
  setter: StatusSetter,
  at: string
): setter is Extract<StatusSetter, { kind: 'external' }> =>
  setter.kind === 'external' &&
  setter.mapping.source !== 'CW' &&
  setter.mapping.whileIn === stageKeyOf(at)

/** (b) A move out of `at` another service's message makes, when it tells CW; CW's own moves are checked from the CW status that made them. */
const otherSends = (
  lifecycle: GrantLifecycle,
  setters: StatusSetter[],
  at: string
): NextSend[] =>
  setters
    .filter((setter) => isOtherMessageAt(setter, at))
    .flatMap(({ to, mapping: { source, code } }) =>
      waysFrom(lifecycle, (from) => from === at, to)
        .flatMap((wayIn) => sentBy(effectsOf(wayIn)))
        .map((sent) => ({
          ...sent,
          at,
          when: { kind: 'sends', source: sourceLabel(source), code } as const
        }))
    )

/** (b) The move the last claim makes from `at`, which GAS tells CW. */
const claimSends = (setters: StatusSetter[], at: string): NextSend[] =>
  setters.flatMap((setter) =>
    setter.kind === 'claim' && setter.from === at && setter.tellsCw
      ? [{ at, sends: setter.to, when: { kind: 'claim' }, onlyWhen: null }]
      : []
  )

/** What GAS may send CW next once CW's message from the status has moved it. */
const nextSends = (
  lifecycle: GrantLifecycle,
  position: GasPosition
): NextSend[] => {
  const setters = toStatusSetters(lifecycle)

  return [
    ...intoSends(lifecycle, position),
    ...otherSends(lifecycle, setters, position.to),
    ...claimSends(setters, position.to)
  ]
}

/** Where GAS is after the message CW sends on reaching the status, which only an action does. */
const gasPositionsOf = (
  place: Place,
  lifecycle: GrantLifecycle
): GasPosition[] =>
  hasActionIn(place)
    ? cwMappingsOf(lifecycle, place.position).flatMap(({ whileIn, to }) =>
        to === null ? [] : [{ whileIn, to }]
      )
    : []

/** The messages GAS may send that the status has no move to: each once. */
const unmovedSends = (place: Place, lifecycle: GrantLifecycle) => {
  const targets = new Set(
    place.status.transitions.map(({ targetPosition }) => targetPosition)
  )
  const sends = gasPositionsOf(place, lifecycle)
    .flatMap((position) => nextSends(lifecycle, position))
    .filter(({ sends }) => sends !== place.position && !targets.has(sends))

  return [
    ...new Map(sends.map((sent) => [JSON.stringify(sent), sent])).values()
  ]
}

const gasStatus = (names: LifecycleNames, position: string): GasStatus => ({
  name: names.status(position),
  position
})

const toMismatches = (
  place: Place,
  lifecycle: GrantLifecycle,
  names: LifecycleNames,
  version: string
): Finding[] =>
  unmovedSends(place, lifecycle)
    .filter(({ onlyWhen }) => onlyWhen === null)
    .map(({ at, sends, when }) => ({
      kind: 'mismatch',
      version,
      at: gasStatus(names, at),
      sends: gasStatus(names, sends),
      when
    }))

/** GAS sends these only when a condition holds that GPA cannot decide at the status, so they never raise a finding. */
const toMaySend = (
  place: Place,
  lifecycle: GrantLifecycle,
  names: LifecycleNames
): MaySend[] =>
  unmovedSends(place, lifecycle).flatMap(({ sends, onlyWhen }) =>
    onlyWhen === null ? [] : [{ onlyWhen, sends: gasStatus(names, sends) }]
  )

const withFindings = (
  index: Map<string, Place>,
  phases: StoredWorkflowPhase[],
  grant: GrantStatusMap,
  version: string
) => {
  const initial = initialOf(phases)
  const checked =
    grant.outcome === 'found' && knowsEffects(grant.lifecycle)
      ? { lifecycle: grant.lifecycle, names: toLifecycleNames(grant.lifecycle) }
      : null

  index.forEach((place) => {
    place.findings = [
      ...findingsOf(place, initial),
      ...(checked
        ? toMismatches(place, checked.lifecycle, checked.names, version)
        : [])
    ]
    place.maySend = checked
      ? toMaySend(place, checked.lifecycle, checked.names)
      : []
  })

  return initial
}

const toMove = (
  from: string,
  { targetPosition, action }: StoredTransition
): StateMove => ({
  from,
  to: targetPosition,
  kind: action ? 'plain' : 'dashed',
  title: action ? `${action.name} (${action.code})` : 'GAS may send'
})

const findingNames = ({ findings }: Place) => [
  ...new Set(findings.map(({ kind }) => kind))
]

const toStateMap = (
  phases: StoredWorkflowPhase[],
  index: Map<string, Place>,
  initial: string | undefined
): StateMap => ({
  phases: phases.map((phase) => ({
    code: phase.code,
    name: phase.name,
    stages: phase.stages.map((stage) => ({
      code: stage.code,
      name: stage.name,
      statuses: stage.statuses.map(({ code, name, theme }) => {
        const position = positionOf(phase.code, stage.code, code)
        const place = index.get(position)
        const findings = place ? findingNames(place) : []

        return {
          code,
          name,
          tone: toThemeRole(theme) ?? 'neutral',
          flagged: findings.length > 0,
          findings,
          ...(position === initial ? { chip: 'start' as const } : {})
        }
      })
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
  { kind: 'dashed', label: 'GAS may send' },
  ...([...index.values()].some(({ findings }) => findings.length)
    ? [{ kind: 'flagged' as const, label: 'Finding' }]
    : []),
  { kind: 'start', label: 'Start' },
  { kind: 'colour', label: 'colour = how CW shows the status to caseworkers' },
  { kind: 'other-phase', label: 'Other phase' }
]

const flagTests: [FlagName, (status: StoredWorkflowStatus) => boolean][] = [
  ['tasks read-only', ({ interactive }) => !interactive],
  ['closes case', ({ closes }) => closes === true],
  ['hides tasks', ({ hideTaskGroups }) => hideTaskGroups]
]

const toFlags = (
  status: StoredWorkflowStatus,
  start: boolean
): PanelBadge<FlagName>[] =>
  toPanelBadges(flagTitles, [
    ...(start ? (['start'] as const) : []),
    ...flagTests.filter(([, test]) => test(status)).map(([label]) => label)
  ])

const commentBadges = (comment: { mandatory: boolean } | null) => {
  if (!comment) {
    return []
  }

  return [comment.mandatory ? 'comment required' : 'comment']
}

const actionBadges = ({ comment, confirm }: StoredAction) => [
  ...commentBadges(comment),
  ...(confirm ? ['confirm'] : [])
]

const hasMandatoryTasks = ({ taskGroups }: StoredWorkflowStage) =>
  (taskGroups ?? []).some(({ tasks }) => tasks.some((task) => task.mandatory))

const toBlockingNote = (
  { action }: StoredTransition,
  phase: StoredWorkflowPhase,
  stage: StoredWorkflowStage,
  links: WorkflowPhasesLinks
): TasksNote =>
  action
    ? {
        kind: 'needs-tasks',
        stageName: stage.name,
        href: links.tasks(phase.code, stage.code)
      }
    : { kind: 'gas-blocked', stageName: stage.name, href: deadLettersHref }

/** A move that checks tasks blocks only while the stage has a mandatory task; otherwise it never does. */
const toTasksNote = (
  transition: StoredTransition,
  phase: StoredWorkflowPhase,
  stage: StoredWorkflowStage,
  links: WorkflowPhasesLinks
): TasksNote | null => {
  if (!checksTasks(transition)) {
    return null
  }

  return hasMandatoryTasks(stage)
    ? toBlockingNote(transition, phase, stage, links)
    : { kind: 'none-in-stage' }
}

const toWayOutMove = ({
  action
}: StoredTransition): WorkflowStatusPanel['waysOut'][number]['move'] =>
  action
    ? {
        kind: 'action',
        name: action.name,
        code: action.code,
        badges: actionBadges(action)
      }
    : { kind: 'gas' }

const toGasTarget = (
  { to }: ExternalStatusMapping,
  names: LifecycleNames,
  grantStatus: (position: string) => string
): TellsGasLine['to'] =>
  to === null
    ? null
    : {
        name: names.status(to),
        position: to,
        href: names.positions.has(to) ? grantStatus(to) : null
      }

const toMappedLines = (
  lifecycle: GrantLifecycle,
  position: string,
  grantStatus: (position: string) => string
): TellsGas => {
  const names = toLifecycleNames(lifecycle)
  const lines = cwMappingsOf(lifecycle, position).map((mapping) => {
    const phase = mapping.whileIn.split(':')[0]

    return {
      stage: {
        code: stageCodeOf(mapping.whileIn),
        name: names.stage(mapping.whileIn)
      },
      phase: { code: phase, name: names.phase(phase) },
      mappedTo: mapping.mappedTo,
      to: toGasTarget(mapping, names, grantStatus)
    }
  })

  return lines.length ? { kind: 'mapped', lines } : { kind: 'ignored' }
}

const toGrantTells = (
  place: Place,
  grant: GrantStatusMap,
  links: WorkflowPhasesLinks,
  version: string
): TellsGas => {
  if (grant.outcome === 'found') {
    return toMappedLines(grant.lifecycle, place.position, (position) =>
      links.grantStatus(position, place.position)
    )
  }

  return grant.outcome === 'not-stored'
    ? { kind: 'not-stored', version, href: links.grant(place.position) }
    : { kind: 'text', text: grant.outcome }
}

/** What GAS does with the `CaseStatusUpdated` CW sends on reaching the status, which only an action does. */
const toTellsGas = (
  place: Place,
  initial: string | undefined,
  grant: GrantStatusMap,
  links: WorkflowPhasesLinks,
  version: string
): TellsGas => {
  if (hasActionIn(place)) {
    return toGrantTells(place, grant, links, version)
  }

  if (place.position === initial) {
    return { kind: 'text', text: 'start' }
  }

  return place.in.length
    ? { kind: 'text', text: 'gas-only' }
    : toGrantTells(place, grant, links, version)
}

interface PanelContext {
  index: Map<string, Place>
  initial: string | undefined
  grant: GrantStatusMap
  links: WorkflowPhasesLinks
  version: string
}

const refFor =
  (index: Map<string, Place>, links: WorkflowPhasesLinks, selected: string) =>
  (target: string): StatusRef => {
    const place = index.get(target)

    return toStatusRef(
      selected,
      target,
      place
        ? {
            name: place.status.name,
            stageName: place.stage.name,
            repeated: false,
            href: `${links.status(target)}#panel`
          }
        : null
    )
  }

const toWaysIn = (place: Place, refOf: (target: string) => StatusRef) =>
  place.findings.some(({ kind }) => kind === 'unreachable')
    ? null
    : place.in.map(({ from, transition: { action } }) => ({
        from: refOf(from),
        via: action
          ? { kind: 'action' as const, name: action.name, code: action.code }
          : { kind: 'gas' as const }
      }))

const toPanel = (place: Place, context: PanelContext): WorkflowStatusPanel => {
  const { position, phase, stage, status } = place
  const { index, initial, grant, links, version } = context
  const refOf = refFor(index, links, position)

  return {
    code: status.code,
    name: status.name,
    role: toThemeRole(status.theme),
    flags: toFlags(status, position === initial),
    phase: { code: phase.code, name: phase.name },
    stage: { code: stage.code, name: stage.name },
    findings: place.findings,
    maySend: place.maySend,
    startsHere: position === initial,
    waysIn: toWaysIn(place, refOf),
    waysOut: status.transitions.map((transition) => ({
      to: refOf(transition.targetPosition),
      move: toWayOutMove(transition),
      tasks: toTasksNote(transition, phase, stage, links)
    })),
    closes: status.closes === true,
    tellsGas: toTellsGas(place, initial, grant, links, version)
  }
}

const findingOrder: Finding['kind'][] = ['dead end', 'unreachable', 'mismatch']

const toFindingsSummary = (
  index: Map<string, Place>,
  links: WorkflowPhasesLinks
): FindingsSummary | null => {
  const groups = findingOrder
    .map((kind) => ({
      kind,
      statuses: [...index.values()]
        .filter(({ findings }) => findings.some((item) => item.kind === kind))
        .map(({ position, status }) => ({
          code: status.code,
          href: `${links.status(position)}#panel`
        }))
    }))
    .filter(({ statuses }) => statuses.length)
  const count = groups.reduce(
    (total, { statuses }) => total + statuses.length,
    0
  )

  return count ? { count, groups } : null
}

/**
 * The workflow's state graphs, with a finding on each status no transition
 * reaches or no transition leaves, or that GAS may send a status it has no
 * move to, and the selected status's panel. Targets are matched literally, as
 * CW matches them; one that is not on the map is listed but not drawn.
 */
export const toWorkflowPhases = (
  phases: StoredWorkflowPhase[],
  grant: GrantStatusMap,
  asked: string | undefined,
  links: WorkflowPhasesLinks,
  version: string
): WorkflowPhasesTab => {
  const index = indexPlaces(phases)
  const initial = withFindings(index, phases, grant, version)
  const graphs = toStateGraphs(
    toStateMap(phases, index, initial),
    asked,
    (position) => `${links.status(position)}#panel`
  )
  const selected = graphs.selected && index.get(graphs.selected.position)

  return {
    graphs,
    legend: toLegend(index),
    findings: toFindingsSummary(index, links),
    panel: selected
      ? toPanel(selected, { index, initial, grant, links, version })
      : null
  }
}
