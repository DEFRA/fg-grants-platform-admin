export interface AttemptCount {
  made: number
  allowed: number
}

const countLabel = /^(\d+)\/(\d+)$/

/** GAS sends the count as `"<failures>/<max>"`. */
export const toAttemptCount = (label: string): AttemptCount | null => {
  const match = countLabel.exec(label)

  return match === null
    ? null
    : { made: Number(match[1]), allowed: Number(match[2]) }
}
