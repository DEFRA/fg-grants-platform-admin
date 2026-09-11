/**
 * A short name for what an event IS, shown where the raw type used to be:
 * `CreateAgreement`, `CaseStatusUpdated`. PascalCase, so it reads as the
 * event's name rather than a sentence about it, set in the sans face to stay
 * distinct from the mono id above it. The raw type stays on the element's
 * title and, on the detail page, as a fact of its own.
 *
 * PascalCase is one mashed word to a screen reader, so every name also comes
 * spaced — `Create agreement` — for the template to put in an `sr-only`
 * beside the visible one. Both are spelled from one list of words, so the two
 * can never disagree.
 *
 * Commands are named in the imperative and notifications in the past tense,
 * the way the types themselves are spelled, so a name still says which of the
 * two a message is.
 *
 * Every other label on these pages — the status labels, the hops, the queue
 * lines — arrives finished from fg-gas-backend. This table is the one this
 * app keeps, because nobody else needed a name yet; it could move there as a
 * `typeLabel` beside `type`, and this module would shrink to its fallback.
 */

export interface EventName {
  /** `AgreementStatusUpdated` — what the page shows. */
  name: string
  /** `Agreement status updated` — what a screen reader says. */
  spoken: string
}

/**
 * fg-gas-backend strips this before a type reaches the page. Stripped here as
 * well, defensively, so a type that ever arrives whole still finds its name
 * whatever environment and service it names.
 */
const namespace = /^cloud\.defra\.[^.]+\.[^.]+\./

/**
 * Keyed on the type exactly as the endpoint sends it. A `Map` rather than an
 * object literal, so a type spelled like an inherited key (`constructor`)
 * finds no words it was never given.
 */
const eventWords = new Map<string, string[]>([
  ['agreement.create', ['create', 'agreement']],
  ['agreement.status.update', ['update', 'agreement', 'status']],
  ['agreement.status.updated', ['agreement', 'status', 'updated']],
  ['application.created', ['application', 'created']],
  ['application.status.updated', ['application', 'status', 'updated']],
  ['case.create', ['create', 'case']],
  ['case.update.status', ['update', 'case', 'status']],
  ['case.status.updated', ['case', 'status', 'updated']],
  ['io.onsite.agreement.create-payment', ['create', 'agreement', 'payment']],
  ['io.onsite.agreement.status.updated', ['agreement', 'status', 'updated']],
  // fg-gas-backend's own labels for the records that are not CloudEvents.
  ['audit', ['audit', 'record']],
  ['unknown', ['no', 'type', 'recorded']]
])

/** Vendor segments: they say who sent a message, not what happened. */
const vendorSegments = new Set(['io', 'onsite'])

/**
 * The last three meaningful segments carry the meaning — `status.updated`
 * under whatever vendor prefix it was published with — so a type this table
 * has never seen still reads as words, split on its separators.
 */
const meaningfulSegments = 3

const toWords = (type: string): string[] =>
  type
    .split('.')
    .filter((segment) => segment !== '' && !vendorSegments.has(segment))
    .slice(-meaningfulSegments)
    .flatMap((segment) => segment.split(/[-_\s]+/))
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase())

const capitalise = (word: string): string =>
  `${word[0].toUpperCase()}${word.slice(1)}`

/**
 * The name for a type. Never empty: a type the table does not know is
 * humanised rather than dropped, and one with no words left in it at all is
 * shown as it came.
 */
export const toEventName = (type: string): EventName => {
  const short = type.replace(namespace, '') || type
  const words = eventWords.get(short) ?? toWords(short)

  if (words.length === 0) {
    return { name: type, spoken: type }
  }

  return {
    name: words.map(capitalise).join(''),
    spoken: capitalise(words.join(' '))
  }
}
