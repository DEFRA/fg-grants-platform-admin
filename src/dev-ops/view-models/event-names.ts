export interface EventName {
  name: string
  spoken: string
}

const namespace = /^cloud\.defra\.[^.]+\.[^.]+\./

/** A Map, so a type spelled like `constructor` finds no words it never had. */
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
  ['audit', ['audit', 'record']],
  ['unknown', ['no', 'type', 'recorded']]
])

const vendorSegments = new Set(['io', 'onsite'])

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
