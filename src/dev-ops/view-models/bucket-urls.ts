import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type { BucketFilters } from './bucket-links.ts'
import { showKey, shownFacts } from './bucket-toggles.ts'

/** The keys of a list's URL that are not filters. */
const rangeKeys = ['from', 'to', 'range']

/** A toggle that is on is `<key>=on` in a URL. */
const toggleOn = 'on'

type UrlQuery = Record<string, string | undefined>

/** A list's filters as its URL spells them: each fact under its declared key, each toggle that is on as `<key>=on`. */
export const toUrlQuery = (
  { facts }: BucketEntry,
  filters: BucketFilters
): UrlQuery => {
  const shown = shownFacts(filters)

  return Object.fromEntries([
    ...facts.map(({ name, param }) => [param, filters[name]]),
    ...facts
      .filter(({ toggle, name }) => toggle !== null && shown.includes(name))
      .map(({ toggle }) => [toggle!.param, toggleOn]),
    ...rangeKeys.map((key) => [key, filters[key]])
  ])
}

const byParam = ({ facts }: BucketEntry) =>
  new Map(facts.map((fact) => [fact.param, fact.name]))

const byToggle = ({ facts }: BucketEntry) =>
  new Map(
    facts
      .filter(({ toggle }) => toggle !== null)
      .map(({ toggle, name }) => [toggle!.param, name])
  )

/** Fixed text, as GAS's own refusals are, that never repeats the key it refuses. */
export const unknownKeyRefusal =
  'A filter in the address is not one this list declares'

/** The keys of a URL this list does not declare: no alias is kept for an old spelling. */
export const unknownKeys = (bucket: BucketEntry, query: UrlQuery): string[] =>
  Object.keys(query).filter(
    (key) =>
      !byParam(bucket).has(key) &&
      !byToggle(bucket).has(key) &&
      !rangeKeys.includes(key)
  )

/** A URL's query as the list's filters: each declared key back to its fact, each toggle that is on into `show`. */
export const fromUrlQuery = (
  bucket: BucketEntry,
  query: UrlQuery
): BucketFilters => {
  const facts = byParam(bucket)
  const toggles = byToggle(bucket)
  const shown = Object.entries(query)
    .filter(([key, value]) => toggles.has(key) && value === toggleOn)
    .map(([key]) => toggles.get(key)!)

  return {
    ...Object.fromEntries(
      Object.entries(query)
        .filter(([key]) => facts.has(key))
        .map(([key, value]) => [facts.get(key)!, value])
    ),
    ...(shown.length ? { [showKey]: shown.join(',') } : {}),
    ...Object.fromEntries(
      Object.entries(query).filter(([key]) => rangeKeys.includes(key))
    )
  }
}
