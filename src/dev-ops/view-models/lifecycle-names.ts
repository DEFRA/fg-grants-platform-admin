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

export const stageKeyOf = (position: string): string =>
  position.split(':').slice(0, 2).join(':')

export const statusCodeOf = (position: string): string =>
  position.split(':')[2] ?? position

/** The stage's own code in a `PHASE:STAGE` key. */
export const stageCodeOf = (stageKey: string): string =>
  stageKey.split(':')[1] ?? stageKey

const lastOf = (key: string) => key.split(':').at(-1) ?? key

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
      const key = `${phase.code}:${stage.code}`

      stages.set(key, stage.name ?? toHumanCode(stage.code))
      stage.statuses.forEach(({ code, name }) => {
        statuses.set(`${key}:${code}`, name ?? toHumanCode(code))
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
