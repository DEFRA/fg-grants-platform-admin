const breakAfter = /(?<=[:_/])/

/** A code split after each `:`, `_` and `/`, where a line may break. */
export const toCodeBreaks = (value: unknown): string[] =>
  String(value ?? '')
    .split(breakAfter)
    .filter((part) => part !== '')
