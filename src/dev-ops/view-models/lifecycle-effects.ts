import type {
  ExternalStatusMapping,
  GrantLifecycle,
  WayIn
} from '../use-cases/get-grant-page.use-case.ts'
import { stageKeyOf, statusCodeOf } from './lifecycle-names.ts'

/** Whether GAS says what its processes do; an older GAS does not, and every warning built on it is left out. */
export const knowsEffects = ({ waysIn }: GrantLifecycle): boolean =>
  waysIn.length > 0 && waysIn.every(({ processEffects }) => processEffects)

/** A process's `setsStatus` lands in the stage of the move it runs on. */
export const gasSetPosition = (target: string, setsStatus: string): string =>
  `${stageKeyOf(target)}:${setsStatus}`

/** A way GAS can take: a move from a status, or one from any status. An unmatched `validFrom` entry never runs. */
export type RunningWay = Extract<WayIn, { kind: 'move' | 'any' }>

export const isRunning = (wayIn: WayIn): wayIn is RunningWay =>
  wayIn.kind !== 'unmatched'

/** The processes a way runs; once GAS says what they do, only those it has a handler for. */
export const runsOf = (wayIn: WayIn, knows: boolean): string[] =>
  knows
    ? (wayIn.processEffects ?? []).map(({ process }) => process)
    : wayIn.processes

/** The ways GAS takes into `to` from `from`. */
export const waysFrom = (
  { waysIn }: GrantLifecycle,
  from: (position: string) => boolean,
  to: string
): RunningWay[] =>
  waysIn
    .filter(isRunning)
    .filter(
      (wayIn) => wayIn.to === to && (wayIn.kind === 'any' || from(wayIn.from))
    )

/** One process GAS runs on a way, and what it does beyond the move. */
export interface GasEffect {
  process: string
  /** The way's target, entered when the process runs. */
  on: string
  /** The status it then sets itself; null when it sets none. */
  sets: string | null
  tellsCw: boolean
  onlyWhen: string | null
}

export const effectsOf = ({ to, processEffects }: WayIn): GasEffect[] =>
  (processEffects ?? []).map(({ process, setsStatus, tellsCw, onlyWhen }) => ({
    process,
    on: to,
    sets: setsStatus ? gasSetPosition(to, setsStatus) : null,
    tellsCw,
    onlyWhen
  }))

/** Submission, a message from another service, the last claim, or a GAS process: the only ways a status is set. */
export type StatusSetter =
  | { kind: 'initial'; to: string }
  | { kind: 'external'; to: string; mapping: ExternalStatusMapping }
  | { kind: 'claim'; from: string; to: string; tellsCw: boolean }
  | {
      kind: 'gas'
      to: string
      process: string
      on: string
      onlyWhen: string | null
    }

const gasSetters = (lifecycle: GrantLifecycle): StatusSetter[] => {
  const setters = lifecycle.waysIn
    .filter(isRunning)
    .flatMap(effectsOf)
    .flatMap(({ process, on, sets, onlyWhen }) =>
      sets ? [{ kind: 'gas' as const, to: sets, process, on, onlyWhen }] : []
    )

  return setters.filter(
    (setter, index) =>
      setters.findIndex(
        ({ process, on, to }) =>
          process === setter.process && on === setter.on && to === setter.to
      ) === index
  )
}

export const toStatusSetters = (lifecycle: GrantLifecycle): StatusSetter[] => {
  const { initialPosition, externalMappings, claimApproval } = lifecycle

  return [
    { kind: 'initial', to: initialPosition },
    ...externalMappings.flatMap((mapping): StatusSetter[] =>
      mapping.to === null ? [] : [{ kind: 'external', to: mapping.to, mapping }]
    ),
    ...(claimApproval
      ? [
          {
            kind: 'claim' as const,
            from: claimApproval.from,
            to: claimApproval.to,
            tellsCw: claimApproval.tellsCw === true
          }
        ]
      : []),
    ...gasSetters(lifecycle)
  ]
}

/** A status as a panel row names it: its name, its stage's name where that helps, and its code beneath. A target not on the map is its code alone. */
export interface StatusRef {
  name: string
  stageName: string | null
  /** The bare code in the selected status's stage, the full position anywhere else. */
  code: string
  position: string
  href: string | null
}

/** What a panel knows of a status on the map. */
export interface KnownStatus {
  name: string
  stageName: string
  /** The code is in more than one stage, so the stage is always named. */
  repeated: boolean
  href: string
}

const toKnownRef = (
  selected: string,
  position: string,
  { name, stageName, repeated, href }: KnownStatus
): StatusRef => {
  const sameStage = stageKeyOf(position) === stageKeyOf(selected)

  return {
    name,
    stageName: sameStage && !repeated ? null : stageName,
    code: sameStage ? statusCodeOf(position) : position,
    position,
    href
  }
}

export const toStatusRef = (
  selected: string,
  position: string,
  known: KnownStatus | null
): StatusRef =>
  known
    ? toKnownRef(selected, position, known)
    : { name: position, stageName: null, code: position, position, href: null }

/** A badge on a status panel, with its meaning as its title and to a screen reader. */
export interface PanelBadge<L extends string> {
  label: L
  title: string
}

export const toPanelBadges = <L extends string>(
  titles: Record<L, string>,
  labels: L[]
): PanelBadge<L>[] => labels.map((label) => ({ label, title: titles[label] }))
