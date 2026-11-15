import type { BucketEntry } from '../repositories/buckets.repository.ts'
import type { BucketFilters, FilterValue } from './bucket-links.ts'

/** The keys of a list's URL that are not filters. */
const rangeKeys = ['from', 'to', 'range']

type UrlQuery = Record<string, FilterValue | undefined>

/** A list's filters as its URL spells them: each fact under its declared key, a fact's several values as one key each. */
export const toUrlQuery = (
  { facts }: BucketEntry,
  filters: BucketFilters
): UrlQuery =>
  Object.fromEntries([
    ...facts.map(({ name, param }) => [param, filters[name]]),
    ...rangeKeys.map((key) => [key, filters[key]])
  ])

const byParam = ({ facts }: BucketEntry) =>
  new Map(facts.map((fact) => [fact.param, fact]))

/** A fact another sits within names a code, which may have no rows yet; any other offers every value it takes. */
const isClosed = (
  { facts }: BucketEntry,
  fact: BucketEntry['facts'][number]
): boolean =>
  fact.values !== null && !facts.some(({ within }) => within === fact.name)

const listOf = (value: FilterValue | undefined): string[] =>
  [value ?? []].flat().filter(Boolean)

const isOffered = (fact: BucketEntry['facts'][number], one: string) =>
  fact.values!.some((option) => String(option.value) === one)

/** A URL's query with only the values its facts offer, so a refused address never shows one as chosen. */
export const withOfferedValues = (
  bucket: BucketEntry,
  query: UrlQuery
): UrlQuery =>
  Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      const fact = byParam(bucket).get(key)

      return fact !== undefined && isClosed(bucket, fact)
        ? [key, listOf(value).filter((one) => isOffered(fact, one))]
        : [key, value]
    })
  )

/** A fact whose values are offered may be filtered by several; any other by one, the first the address gives. */
const toFilter = (
  { values }: BucketEntry['facts'][number],
  value: FilterValue | undefined
): FilterValue | undefined =>
  values === null ? listOf(value)[0] : [...new Set(listOf(value))]

/** A URL's query as the list's filters: each declared key back to its fact. */
export const fromUrlQuery = (
  bucket: BucketEntry,
  query: UrlQuery
): BucketFilters => {
  const facts = byParam(bucket)

  return {
    ...Object.fromEntries(
      Object.entries(query)
        .filter(([key]) => facts.has(key))
        .map(([key, value]) => {
          const fact = facts.get(key)!

          return [fact.name, toFilter(fact, value)]
        })
    ),
    ...Object.fromEntries(
      Object.entries(query).filter(([key]) => rangeKeys.includes(key))
    )
  }
}
