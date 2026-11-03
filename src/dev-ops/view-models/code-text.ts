const breakAt = /(?<=[:_/(])|(?<=\.)(?=\D)|(?=\[)/

/** A code split after each `:`, `_`, `/`, `(` and `.` not before a digit, and before each `[`, where a line may break. */
export const toCodeBreaks = (value: unknown): string[] =>
  String(value ?? '')
    .split(breakAt)
    .filter((part) => part !== '')
