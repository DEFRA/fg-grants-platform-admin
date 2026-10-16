import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type { BucketFilters } from './bucket-links.ts'

/** The URL key that lists, comma-separated, the facts whose hidden values are shown. */
export const showKey = 'show'

export const shownFacts = (filters: BucketFilters): string[] =>
  (filters[showKey] ?? '').split(',').filter(Boolean)

const withShow = (filters: BucketFilters, facts: string[]): BucketFilters => ({
  ...filters,
  [showKey]: facts.length ? facts.join(',') : undefined
})

const hides = ({ facts }: BucketEntry, name: string, value: string): boolean =>
  facts
    .find((fact) => fact.name === name)
    ?.values?.some(
      (option) => option.hidden && String(option.value) === value
    ) ?? false

/** The facts a URL filters by a value their toggle hides. */
const namedHidden = (bucket: BucketEntry, filters: BucketFilters): string[] =>
  bucket.facts
    .filter(({ toggle }) => toggle !== null)
    .map(({ name }) => name)
    .filter((name) => hides(bucket, name, filters[name] ?? ''))

/** A URL that names a hidden value asks to see it, so its fact counts as shown from there on. */
export const withShown = (
  bucket: BucketEntry,
  filters: BucketFilters
): BucketFilters => {
  const shown = shownFacts(filters)
  const asked = namedHidden(bucket, filters).filter(
    (name) => !shown.includes(name)
  )

  return asked.length ? withShow(filters, [...shown, ...asked]) : filters
}

/** The filters with one toggle switched over; switching off also drops a hidden value it was filtered by. */
export const withToggled = (
  bucket: BucketEntry,
  filters: BucketFilters,
  fact: string
): BucketFilters => {
  const shown = shownFacts(filters)

  return shown.includes(fact)
    ? {
        ...withShow(
          filters,
          shown.filter((name) => name !== fact)
        ),
        [fact]: hides(bucket, fact, filters[fact] ?? '')
          ? undefined
          : filters[fact]
      }
    : withShow(filters, [...shown, fact])
}
