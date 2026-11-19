import type { HeldSave } from './event-payload.ts'

export const heldSavesKey = 'heldSaves'

/** Long enough to come back from the save's redirect, short enough that held text never stands in for a later edit. */
const heldMaxMinutes = 5

const heldMaxAgeMs = heldMaxMinutes * 60 * 1000

export interface HeldEntry extends HeldSave {
  heldAt: number
}

/** By the event's page, so a save held on one event is only ever drawn on it. */
export type HeldSaves = Record<string, HeldEntry>

const freshOf = (saves: HeldSaves, now: number): HeldSaves =>
  Object.fromEntries(
    Object.entries(saves).filter(
      ([, { heldAt }]) => now - heldAt <= heldMaxAgeMs
    )
  )

/** A save the service didn't answer or failed: the operator's own edit, kept for the page the save redirects to. */
export const toHeldSaves = (
  saves: HeldSaves | null,
  eventHref: string,
  held: HeldSave,
  now: number
): HeldSaves => ({
  ...freshOf(saves ?? {}, now),
  [eventHref]: { ...held, heldAt: now }
})

const toHeld = ({
  failure,
  text,
  revision,
  note,
  then
}: HeldEntry): HeldSave => ({
  failure,
  text,
  revision,
  note,
  then
})

/** The save held for this event, spent on this render, and the others still fresh enough to keep. */
export const takeHeldSave = (
  saves: HeldSaves | null,
  eventHref: string,
  now: number
): { held: HeldSave | null; kept: HeldSaves } => {
  const { [eventHref]: entry, ...kept } = freshOf(saves ?? {}, now)

  return { held: entry ? toHeld(entry) : null, kept }
}
