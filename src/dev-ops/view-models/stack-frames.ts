const frameLine = /^\s+at /

const indentOf = (line: string): number => line.length - line.trimStart().length

export const toStackFrames = (
  name: string,
  message: string,
  stack: string | null
): string | null => {
  if (stack === null) {
    return null
  }

  const lines = stack.split('\n')
  const first = lines.findIndex((line) => frameLine.test(line))

  if (first <= 0) {
    return stack
  }

  const header = lines.slice(0, first).join('\n').trim()

  if (header !== `${name}: ${message}`.trim()) {
    return stack
  }

  const frames = lines.slice(first)
  const common = Math.min(
    ...frames.filter((line) => line.trim() !== '').map(indentOf)
  )

  return frames
    .map((line) => line.slice(Math.min(common, indentOf(line))))
    .join('\n')
}
