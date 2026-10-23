import type {
  ExternalStatusMapping,
  GrantLifecycle,
  WayIn
} from '../use-cases/get-grant-page.use-case.ts'
import {
  knowsEffects,
  runsOf,
  toPanelBadges,
  toStatusRef,
  toStatusSetters
} from './lifecycle-effects.ts'
import type {
  PanelBadge,
  StatusRef,
  StatusSetter
} from './lifecycle-effects.ts'
import {
  sourceLabel,
  stageCodeOf,
  stageKeyOf,
  statusCodeOf,
  toLifecycleNames
} from './lifecycle-names.ts'
import type { LifecycleNames } from './lifecycle-names.ts'
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
  kind: MoveKind | 'flagged' | 'other-phase'
  label: string
}

/** The bare `validFrom` code a way matched by; said aloud only where that code is in more than one stage, else in its title. */
type BareCode = { bareCode: { code: string; said: boolean } | null }

type WayInRow = { processes: string[] } & (
  | ({ kind: 'move'; from: StatusRef } & BareCode)
  | ({ kind: 'code'; code: string } & BareCode)
  | { kind: 'any' }
)

/** What makes a move happen, said after the move. */
type TriggerSummary =
  | { kind: 'sends'; source: string; code: string }
  | { kind: 'claim' }
  | { kind: 'gas'; process: string }

export interface WayOutRow extends BareCode {
  to: StatusRef
  processes: string[]
  triggers: TriggerSummary[]
  /** Said only when GAS says what its processes do, so it is never guessed. */
  untriggered: boolean
}

type TriggerRow =
  | {
      kind: 'external'
      source: string
      code: string
      href: string | null
      stageName: string
      /** The stage this version has not got, for a mapping only an earlier version's applications can meet. */
      missingStage: string | null
    }
  | { kind: 'claim'; at: StatusRef; href: string }
  | {
      kind: 'gas'
      process: string
      onEntering: string
      onlyWhen: string | null
    }

type BadgeLabel = 'initial' | 'amendable'

/** A position a GAS process sets that the grant does not define. */
interface UndefinedTarget {
  position: string
  onlyWhen: string | null
}

interface CodeAndName {
  code: string
  name: string
}

export interface StatusPanel {
  badges: PanelBadge<BadgeLabel>[]
  phase: CodeAndName
  stage: CodeAndName
  undefinedTargets: UndefinedTarget[]
  waysIn: WayInRow[]
  waysOut: WayOutRow[]
  triggeredBy: TriggerRow[]
  /** What an empty Triggered by says; null says nothing. */
  noTrigger: 'initial' | 'nothing' | null
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
  /** Null when CW lacks this workflow version or cannot say. */
  workflowHref: ((cwStatus: string, back: string) => string) | null
}

const nothingSetsIt = 'nothing in this version sets it'

const bareCodeLegend: LegendItem = {
  kind: 'dotted',
  label: 'Matched by status code only, in any stage'
}

const flaggedLegend: LegendItem = {
  kind: 'flagged',
  label: 'Nothing in this version sets it'
}

const isBare = (wayIn: WayIn): boolean =>
  'matchedBy' in wayIn && wayIn.matchedBy === 'status'

/** Known only when GAS says a way matched by a bare code; an older GAS says nothing of how it matched. */
const toBareCode = (
  { names }: Context,
  wayIn: WayIn,
  position: string
): BareCode['bareCode'] =>
  isBare(wayIn)
    ? { code: statusCodeOf(position), said: names.repeated(position) }
    : null

const toLegend = ({ waysIn }: GrantLifecycle, map: StateMap): LegendItem[] => [
  { kind: 'strong', label: 'Runs a GAS process on the move' },
  { kind: 'dashed', label: 'Move only' },
  { kind: 'other-phase', label: 'Other phase' },
  ...(map.phases.some(({ stages }) =>
    stages.some(({ statuses }) => statuses.some(({ flagged }) => flagged))
  )
    ? [flaggedLegend]
    : []),
  ...(waysIn.some((wayIn) => isMove(wayIn) && isBare(wayIn))
    ? [bareCodeLegend]
    : [])
]

const badgeTexts: Record<BadgeLabel, string> = {
  initial: 'New applications start here',
  amendable:
    'The applicant can submit an amended application from here (amendablePositions)'
}

const isMove = (wayIn: WayIn): wayIn is Move => wayIn.kind === 'move'

interface Context {
  lifecycle: GrantLifecycle
  names: LifecycleNames
  setters: StatusSetter[]
  knows: boolean
  hrefOf: (position: string) => string
}

const isTriggered = ({ setters }: Context, position: string) =>
  setters.some(({ to }) => to === position)

const toMoveKind = (move: Move, processes: string[]): MoveKind => {
  if (isBare(move)) {
    return 'dotted'
  }

  return processes.length ? 'strong' : 'dashed'
}

const toMove =
  (knows: boolean) =>
  (move: Move): StateMove => {
    const { from, to } = move
    const processes = runsOf(move, knows)

    return {
      from,
      to,
      kind: toMoveKind(move, processes),
      title: processes.length
        ? `${from} → ${to}: ${processes.join(', ')}`
        : `${from} → ${to}`
    }
  }

const fromAnyStatus = ({ waysIn }: GrantLifecycle, position: string) =>
  waysIn.some(({ to, kind }) => to === position && kind === 'any')

const toStateMap = (context: Context): StateMap => {
  const { lifecycle, names, knows } = context

  return {
    phases: lifecycle.phases.map((phase) => ({
      ...phase,
      stages: phase.stages.map((stage) => ({
        ...stage,
        statuses: stage.statuses.map(({ code }) => {
          const position = `${phase.code}:${stage.code}:${code}`
          const flagged = knows && !isTriggered(context, position)

          return {
            code,
            name: names.status(position),
            tone: null,
            flagged,
            findings: flagged ? [nothingSetsIt] : [],
            ...(fromAnyStatus(lifecycle, position)
              ? { chip: 'any status' as const }
              : {})
          }
        })
      }))
    })),
    moves: lifecycle.waysIn.filter(isMove).map(toMove(knows))
  }
}

const refFor =
  ({ names, hrefOf }: Context, selected: string) =>
  (position: string): StatusRef =>
    toStatusRef(selected, position, {
      name: names.status(position),
      stageName: names.stage(stageKeyOf(position)),
      repeated: names.repeated(position),
      href: `${hrefOf(position)}#panel`
    })

const toBadges = (
  { initialPosition, amendablePositions }: GrantLifecycle,
  position: string
): PanelBadge<BadgeLabel>[] =>
  toPanelBadges(badgeTexts, [
    ...(position === initialPosition ? (['initial'] as const) : []),
    ...(amendablePositions.includes(position) ? (['amendable'] as const) : [])
  ])

const toWayIn =
  (context: Context, refOf: (position: string) => StatusRef) =>
  (wayIn: WayIn): WayInRow => {
    if (wayIn.kind === 'move') {
      return {
        kind: 'move',
        from: refOf(wayIn.from),
        processes: runsOf(wayIn, context.knows),
        bareCode: toBareCode(context, wayIn, wayIn.from)
      }
    }

    return wayIn.kind === 'unmatched'
      ? {
          kind: 'code',
          code: wayIn.code,
          processes: runsOf(wayIn, context.knows),
          bareCode: toBareCode(context, wayIn, wayIn.code)
        }
      : { kind: 'any', processes: runsOf(wayIn, context.knows) }
  }

const toTrigger = (setter: StatusSetter): TriggerSummary[] => {
  if (setter.kind === 'external') {
    const { source, code } = setter.mapping

    return [{ kind: 'sends', source: sourceLabel(source), code }]
  }

  if (setter.kind === 'claim') {
    return [{ kind: 'claim' }]
  }

  return setter.kind === 'gas' ? [{ kind: 'gas', process: setter.process }] : []
}

/** Whether the setter moves an application at `from`: a message keyed on its stage, the last claim at that exact status, or a GAS process run on entering it. */
const setsFrom = (setter: StatusSetter, from: string): boolean => {
  if (setter.kind === 'external') {
    return setter.mapping.whileIn === stageKeyOf(from)
  }

  if (setter.kind === 'claim') {
    return setter.from === from
  }

  return setter.kind === 'gas' && setter.on === from
}

/** What moves an application from `from` to `to`. */
const toTriggers = (
  { setters }: Context,
  from: string,
  to: string
): TriggerSummary[] =>
  setters
    .filter((setter) => setter.to === to && setsFrom(setter, from))
    .flatMap(toTrigger)

const toWayOut =
  (context: Context, selected: string, refOf: (p: string) => StatusRef) =>
  (move: Move): WayOutRow => {
    const triggers = toTriggers(context, selected, move.to)

    return {
      to: refOf(move.to),
      processes: runsOf(move, context.knows),
      bareCode: toBareCode(context, move, selected),
      triggers,
      untriggered: context.knows && triggers.length === 0
    }
  }

/** @param back Where a link to the workflow comes back to. */
const toExternal =
  (
    { names }: Context,
    back: string,
    workflowHref: GrantPhasesOptions['workflowHref']
  ) =>
  ({ source, code, whileIn }: ExternalStatusMapping): TriggerRow => ({
    kind: 'external',
    source: sourceLabel(source),
    code,
    href: source === 'CW' && workflowHref ? workflowHref(code, back) : null,
    stageName: names.stage(whileIn),
    missingStage: names.stages.has(whileIn) ? null : stageCodeOf(whileIn)
  })

const toTriggerRow =
  (
    context: Context,
    position: string,
    workflowHref: GrantPhasesOptions['workflowHref'],
    entitlementsHref: string
  ) =>
  (setter: StatusSetter): TriggerRow[] => {
    if (setter.kind === 'external') {
      return [
        toExternal(
          context,
          context.hrefOf(position),
          workflowHref
        )(setter.mapping)
      ]
    }

    if (setter.kind === 'claim') {
      return [
        {
          kind: 'claim',
          at: refFor(context, position)(setter.from),
          href: entitlementsHref
        }
      ]
    }

    return setter.kind === 'gas'
      ? [
          {
            kind: 'gas',
            process: setter.process,
            onEntering: context.names.status(setter.on),
            onlyWhen: setter.onlyWhen
          }
        ]
      : []
  }

const toTriggeredBy = (
  context: Context,
  position: string,
  workflowHref: GrantPhasesOptions['workflowHref'],
  entitlementsHref: string
): TriggerRow[] =>
  context.setters
    .filter(({ to }) => to === position)
    .flatMap(toTriggerRow(context, position, workflowHref, entitlementsHref))

/** A position a GAS process sets on entering `position` that the grant does not define. */
const toUndefinedTargets = (
  { setters, names }: Context,
  position: string
): UndefinedTarget[] =>
  setters.flatMap((setter) =>
    setter.kind === 'gas' &&
    setter.on === position &&
    !names.positions.has(setter.to)
      ? [{ position: setter.to, onlyWhen: setter.onlyWhen }]
      : []
  )

const toNoTrigger = (
  { lifecycle, knows }: Context,
  position: string,
  triggeredBy: TriggerRow[]
): StatusPanel['noTrigger'] => {
  if (triggeredBy.length) {
    return null
  }

  if (position === lifecycle.initialPosition) {
    return 'initial'
  }

  return knows ? 'nothing' : null
}

const toPanel = (
  context: Context,
  { position, phase, stage }: NonNullable<StateGraphs['selected']>,
  workflowHref: GrantPhasesOptions['workflowHref'],
  entitlementsHref: string
): StatusPanel => {
  const { lifecycle, names } = context
  const refOf = refFor(context, position)
  const triggeredBy = toTriggeredBy(
    context,
    position,
    workflowHref,
    entitlementsHref
  )

  return {
    badges: toBadges(lifecycle, position),
    phase: { code: phase.code, name: names.phase(phase.code) },
    stage: {
      code: stage.code,
      name: names.stage(`${phase.code}:${stage.code}`)
    },
    undefinedTargets: toUndefinedTargets(context, position),
    waysIn: lifecycle.waysIn
      .filter(({ to }) => to === position)
      .map(toWayIn(context, refOf)),
    waysOut: lifecycle.waysIn
      .filter(isMove)
      .filter(({ from }) => from === position)
      .map(toWayOut(context, position, refOf)),
    triggeredBy,
    noTrigger: toNoTrigger(context, position, triggeredBy)
  }
}

const toContext = (
  lifecycle: GrantLifecycle,
  hrefOf: (position: string) => string
): Context => ({
  lifecycle,
  names: toLifecycleNames(lifecycle),
  setters: toStatusSetters(lifecycle),
  knows: knowsEffects(lifecycle),
  hrefOf
})

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
  const context = toContext(lifecycle, hrefOf)
  const map = toStateMap(context)
  const graphs = toStateGraphs(
    map,
    status,
    (position) => `${hrefOf(position)}#panel`
  )

  return {
    kind: 'graph',
    graphs,
    legend: toLegend(lifecycle, map),
    panel:
      graphs.selected &&
      toPanel(
        context,
        graphs.selected,
        workflowHref,
        toTabHref(href, 'entitlements', from)
      )
  }
}
