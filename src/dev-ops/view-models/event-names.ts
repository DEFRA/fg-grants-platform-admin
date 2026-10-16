export interface EventName {
  name: string
  spoken: string
}

const capitalise = (word: string): string =>
  `${word[0].toUpperCase()}${word.slice(1)}`

const wordStart = /(?!^)(?=[A-Z])/

/** A stored event type is already the name to show; only its spoken form is worked out, word by word. */
export const toStampedEventName = (name: string): EventName => ({
  name,
  spoken: capitalise(name.split(wordStart).join(' ').toLowerCase())
})
