/** One part of a sentence a view model writes: plain text, or a code, a bold word or a link, each drawn its own way. */
export type Word =
  | string
  | { code: string }
  | { strong: string }
  | { link: string; href: string }

export type Words = Word[]

export const toAndList = (words: string[]): string =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

/** "definition" or "definitions", by how many files there are. */
export const toDefinitionNoun = (count: number): string =>
  count === 1 ? 'definition' : 'definitions'
