/** The UK wall clock every dev-ops page writes times in. Free of server modules, so the browser can format with it too. */

/**
 * `Europe/London` rather than a fixed offset, so the display follows the
 * clocks by itself and nothing needs correcting twice a year. No date is
 * rendered with a zone suffix; the instant behind each one is carried by the
 * `<time datetime>` attribute, which stays UTC.
 */
export const displayZone = 'Europe/London'

/** `1 Sep 08:18`: day-first from parts, with `en-US` months because `en-GB` writes `Sept`. */
const dayClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: displayZone,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

/** `2026-09-16T09:00:00`: the digits a `datetime-local` box carries. */
const inputFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: displayZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

export const partsOf = (
  format: Intl.DateTimeFormat,
  date: Date
): Record<string, string> =>
  Object.fromEntries(
    format
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

/** An instant as the display zone's wall clock, `yyyy-mm-ddThh:mm:ss`; whole seconds, which is all a range box carries. */
export const toZonedInput = (date: Date): string => {
  const parts = partsOf(inputFormat, date)

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/** `15 Oct 10:04`, in UK time. */
export const toDayClock = (date: Date): string => {
  const parts = partsOf(dayClockFormat, date)

  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`
}

/**
 * Measured, never assumed: BST and GMT differ by an hour and the switch moves.
 * Read at the whole second, because `toZonedInput` spells no milliseconds —
 * subtracting like from like leaves the offset exact for any instant.
 */
const zoneOffsetMs = (instant: Date): number => {
  const whole = instant.getTime() - instant.getUTCMilliseconds()

  return Date.parse(`${toZonedInput(new Date(whole))}Z`) - whole
}

export const msPerSecond = 1000
export const secondsPerMinute = 60
export const minutesPerHour = 60
export const hoursPerDay = 24
export const msPerMinute = msPerSecond * secondsPerMinute
export const msPerDay = msPerMinute * minutesPerHour * hoursPerDay

/** Far enough either side of a wall clock to read the offset past any clock change near it. */
const offsetProbeMs = msPerDay / 2

/** Which end of an hour the clocks hand out twice a given box should take. */
export type ZonedEdge = 'earliest' | 'latest'

/**
 * The instants that really are this wall clock: two on the autumn morning the
 * hour repeats, none in the spring hour that never happens, one otherwise.
 */
const instantsFor = (wallClockMs: number): Date[] => {
  const offsets = [-offsetProbeMs, offsetProbeMs].map((shift) =>
    zoneOffsetMs(new Date(wallClockMs + shift))
  )

  return [...new Set(offsets)]
    .map((offset) => new Date(wallClockMs - offset))
    .filter(
      (instant) => zoneOffsetMs(instant) === wallClockMs - instant.getTime()
    )
}

/**
 * The reverse of `toZonedInput`, taking back the same `yyyy-mm-ddThh:mm:ss`
 * digits it hands out. An ambiguous hour widens the range rather than dropping
 * events from it: the `from` box takes the first time the clock reads that,
 * the `to` box the second. An hour that never happened has no instant to take,
 * so the wall clock is read against the offset in force *before* the change,
 * which lands it just after — 01:30 on a spring morning becomes 02:30.
 */
export const fromZonedInput = (wallClock: string, edge: ZonedEdge): Date => {
  const wallClockMs = Date.parse(`${wallClock}Z`)
  const instants = instantsFor(wallClockMs)

  if (instants.length === 0) {
    const provisional = new Date(
      wallClockMs - zoneOffsetMs(new Date(wallClockMs))
    )

    return new Date(wallClockMs - zoneOffsetMs(provisional))
  }

  const pick = edge === 'earliest' ? Math.min : Math.max

  return new Date(pick(...instants.map((instant) => instant.getTime())))
}
