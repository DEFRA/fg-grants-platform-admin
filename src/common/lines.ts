const newline = 0x0a

/** A line longer than the reader holds: the stream isn't what it should be, or broke. */
export class LineTooLongError extends Error {
  constructor() {
    super('A line is longer than its reader holds')
    this.name = 'LineTooLongError'
  }
}

/** The bytes held since the last line ended. */
interface Held {
  parts: Buffer[]
  bytes: number
}

const toLine = (held: Held): string => {
  const line = Buffer.concat(held.parts).toString('utf8')

  held.parts = []
  held.bytes = 0

  return line
}

const hold = (held: Held, part: Buffer, max: number): void => {
  held.parts.push(part)
  held.bytes += part.length

  if (held.bytes > max) {
    throw new LineTooLongError()
  }
}

/** The whole lines in a chunk, holding what follows the last of them. */
const linesIn = function* (
  chunk: Buffer,
  held: Held,
  max: number
): Generator<string> {
  let from = 0
  let at = chunk.indexOf(newline)

  while (at >= 0) {
    hold(held, chunk.subarray(from, at), max)
    yield toLine(held)
    from = at + 1
    at = chunk.indexOf(newline, from)
  }

  hold(held, chunk.subarray(from), max)
}

/**
 * A stream's `\n`-terminated lines as text, read as they come: at most one
 * line, and the chunk it ends in, held at a time. A line longer than `max`
 * bytes throws; text after the last `\n` is not a line, so it is dropped.
 */
export const readLines = async function* (
  stream: AsyncIterable<Buffer | string>,
  max: number
): AsyncGenerator<string> {
  const held: Held = { parts: [], bytes: 0 }

  for await (const chunk of stream) {
    yield* linesIn(
      typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
      held,
      max
    )
  }
}
