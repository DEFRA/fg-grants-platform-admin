import type { BucketEntry } from '../repositories/buckets.repository.ts'

/** The fact Top errors groups a list's events by: the error's name and message, as both services key it. */
export const errorKeyFact = 'errorKey'

/** The key both services store a dead letter that recorded no error under. */
export const noErrorKey = 'No error recorded'

const errorKindPrefix = 'error:'

/** The search field's kind for the error, beside the kinds GAS searches by: it names the key the error is set under in the address. */
export const toErrorKind = (param: string): string =>
  `${errorKindPrefix}${param}`

/** The address key an Error search sets; null for any other kind. */
export const errorParamOfKind = (kind: string): string | null =>
  kind.startsWith(errorKindPrefix) ? kind.slice(errorKindPrefix.length) : null

export const errorKindLabel = 'Error'

/** Beside the field's text, the key that text was shown for. */
export const shownErrorField = 'ref-error'

/** Beside any search, the key the list takes the error under, so a search held knows it before the list is drawn again. */
export const errorAtField = 'ref-error-at'

const thrownPrefix = 'Error: '

/** The longest key an error can have, as GAS cuts every error's key to it: a longer one never matches. */
export const errorKeyMax = 120

const lengthOf = (text: string): number => Array.from(text).length

/** The most characters the field's text can have for the key it stands for to fit: fewer by `Error: ` where that is put back. */
export const toErrorTextMax = (text: string, shown: string): number =>
  errorKeyMax - (lengthOf(toErrorKey(text, shown)) - lengthOf(text))

/** Null for text whose key fits; else why not, by the most characters it can have. */
export const toErrorSearchError = (
  text: string,
  shown: string
): string | null => {
  const most = toErrorTextMax(text, shown)

  return lengthOf(text) > most
    ? `Enter an error of up to ${most} characters`
    : null
}

/** The address key a list takes the error under; null for a list with no error fact. */
export const errorParamOf = (bucket: BucketEntry | null): string | null =>
  bucket?.facts.find(({ name }) => name === errorKeyFact)?.param ?? null

/** The address sets the error the list takes under `param`. */
export const isErrorSet = (
  address: Record<string, string | string[] | undefined>,
  param: string | null
): boolean => param !== null && Boolean(address[param]?.length)

/** GAS keys a thrown Error as `Error: <message>`, and GPA shows the message. */
export const toErrorText = (errorKey: string): string =>
  errorKey.startsWith(thrownPrefix)
    ? errorKey.slice(thrownPrefix.length)
    : errorKey

const named = /^[A-Za-z_$][\w$]*: /

const isShownAs = (shown: string, text: string): boolean =>
  shown !== '' && text === toErrorText(shown)

const isWholeKey = (text: string): boolean =>
  text === noErrorKey || named.test(text)

/**
 * The key typed text stands for: the key it was shown for while it is
 * unchanged; else as typed when it names its error or is the no-error key,
 * else a thrown Error's.
 */
export const toErrorKey = (text: string, shown: string): string => {
  if (isShownAs(shown, text)) {
    return shown
  }

  return isWholeKey(text) ? text : `${thrownPrefix}${text}`
}
