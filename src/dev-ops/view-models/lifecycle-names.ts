import type { GrantLifecycle } from '../use-cases/get-grant-page.use-case.ts'
import { toHumanCode } from './position.ts'

/** What a grant's lifecycle calls its phases, stages and statuses: the definition's name, else the code made readable. */
export interface LifecycleNames {
  status: (position: string) => string
  stage: (stageKey: string) => string
  phase: (code: string) => string
  /** The positions the grant defines. */
  positions: Set<string>
  /** The `PHASE:STAGE` keys the grant defines. */
  stages: Set<string>
  /** Whether the status code is in more than one stage. */
  repeated: (position: string) => boolean
}

const sourceLabels = new Map([
  ['CW', 'CW'],
  ['AS', 'Agreements']
])

/** The service a status mapping comes from, as operators name it. */
export const sourceLabel = (source: string): string =>
  sourceLabels.get(source) ?? `unknown source ${source}`

/** A position is `PHASE:STAGE:STATUS`; its stage is the `PHASE:STAGE` key. */
const separator = ':'

/** The codes a position, stage key or bare status code is made of. */
export const toPositionParts = (text: string): string[] => text.split(separator)

export const toStageKey = (phase: string, stage: string): string =>
  [phase, stage].join(separator)

export const toPosition = (
  phase: string,
  stage: string,
  status: string
): string => [phase, stage, status].join(separator)

export const stageKeyOf = (position: string): string =>
  toPositionParts(position).slice(0, 2).join(separator)

export const statusCodeOf = (position: string): string =>
  toPositionParts(position)[2] ?? position

/** The stage's own code in a `PHASE:STAGE` key or a position. */
export const stageCodeOf = (stageKey: string): string =>
  toPositionParts(stageKey)[1] ?? stageKey

/** The phase's code in a position or stage key. */
export const phaseCodeOf = (key: string): string => toPositionParts(key)[0]

const lastOf = (key: string) => toPositionParts(key).at(-1) ?? key

export const toLifecycleNames = ({
  phases
}: GrantLifecycle): LifecycleNames => {
  const statuses = new Map<string, string>()
  const stages = new Map<string, string>()
  const phaseNames = new Map<string, string>()
  const codeCounts = new Map<string, number>()

  phases.forEach((phase) => {
    phaseNames.set(phase.code, phase.name ?? toHumanCode(phase.code))
    phase.stages.forEach((stage) => {
      const key = toStageKey(phase.code, stage.code)

      stages.set(key, stage.name ?? toHumanCode(stage.code))
      stage.statuses.forEach(({ code, name }) => {
        statuses.set(
          toPosition(phase.code, stage.code, code),
          name ?? toHumanCode(code)
        )
        codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
      })
    })
  })

  return {
    status: (position) =>
      statuses.get(position) ?? toHumanCode(statusCodeOf(position)),
    stage: (key) => stages.get(key) ?? toHumanCode(lastOf(key)),
    phase: (code) => phaseNames.get(code) ?? toHumanCode(code),
    positions: new Set(statuses.keys()),
    stages: new Set(stages.keys()),
    repeated: (position) => (codeCounts.get(statusCodeOf(position)) ?? 0) > 1
  }
}
