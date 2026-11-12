import type {
  BucketEntry,
  BucketFields,
  BucketSearchField
} from '../use-cases/get-catalogue.use-case.ts'
import type { BucketFilters } from './bucket-links.ts'
import { present } from './list-filters.ts'

/** A field's kind in the search menu and the session, apart from any identifier kind. */
const fieldKindPrefix = 'field.'

export const toFieldKind = (key: string): string => `${fieldKindPrefix}${key}`

export const isFieldKind = (kind: string): boolean =>
  kind.startsWith(fieldKindPrefix)

const declaredBy = (
  { byValue }: BucketFields,
  chosen: string | undefined
): BucketSearchField[] =>
  chosen && Object.hasOwn(byValue, chosen) ? byValue[chosen] : []

/** GAS refuses a field search beside any filter but the lead; a time range is not a filter. */
const hasOtherFilter = (
  { facts, fields }: BucketEntry,
  filters: BucketFilters
): boolean => facts.some(({ name }) => name !== fields?.fact && filters[name])

const declaredFor = (
  { fields }: BucketEntry,
  filters: BucketFilters
): BucketSearchField[] =>
  fields ? declaredBy(fields, filters[fields.fact]) : []

/** The fields the one chosen value of the list's lead fact declares; none until one is chosen, or beside another filter. */
export const offeredFields = (
  bucket: BucketEntry,
  filters: BucketFilters
): BucketSearchField[] =>
  hasOtherFilter(bucket, filters) ? [] : declaredFor(bucket, filters)

export const toOfferedField = (
  bucket: BucketEntry,
  filters: BucketFilters,
  kind: string
): BucketSearchField | null =>
  offeredFields(bucket, filters).find(({ key }) => toFieldKind(key) === kind) ??
  null

/** "grant" on Applications, "workflow" on Cases: the fact a list's fields are declared by. */
export const toLeadName = ({ facts, fields }: BucketEntry): string =>
  (facts.find(({ name }) => name === fields?.fact)?.label ?? '').toLowerCase()

const optionsOf = ({ facts, fields }: BucketEntry) =>
  facts.find(({ name }) => name === fields?.fact)?.values ?? []

const toChosenLabel = (bucket: BucketEntry, value: string): string =>
  optionsOf(bucket).find((option) => String(option.value) === value)?.label ??
  value

/** Why fields are held back while the chosen value declares some: other filters are set beside it. */
export const toClearFiltersHint = (
  bucket: BucketEntry,
  filters: BucketFilters
): string | null =>
  hasOtherFilter(bucket, filters) && declaredFor(bucket, filters).length
    ? `Clear the other filters to search by ${toChosenLabel(bucket, filters[bucket.fields!.fact]!)}'s own fields`
    : null

export const toFieldsHint = (
  bucket: BucketEntry,
  filters: BucketFilters
): string | null =>
  bucket.fields && !filters[bucket.fields.fact]
    ? `Choose a ${toLeadName(bucket)} to search by its own fields`
    : toClearFiltersHint(bucket, filters)

const folds: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  þ: 'th',
  œ: 'oe'
}

/** As GAS and CW fold a value before matching it: accents, case and punctuation dropped, ß, æ, ø and the like spelt out. */
export const normaliseFieldValue = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[ßæøłđþœ]/gu, (letter) => folds[letter] ?? letter)
    .replaceAll(/[^\p{L}\p{N}]/gu, '')

const valueMax = 200

const prefixMin = 3

const control = /\p{Cc}/u

interface Rule {
  breaks: (value: string, field: BucketSearchField) => boolean
  says: (label: string) => string
}

const rules: Rule[] = [
  {
    breaks: (value) => value.length > valueMax,
    says: (label) => `${label} must be ${valueMax} characters or fewer`
  },
  {
    breaks: (value) => control.test(value),
    says: (label) => `${label} must not contain control characters`
  },
  {
    breaks: (value) => normaliseFieldValue(value) === '',
    says: (label) => `${label} must contain a letter or number`
  },
  {
    breaks: (value, { match }) =>
      match === 'prefix' && normaliseFieldValue(value).length < prefixMin,
    says: (label) =>
      `Enter at least ${prefixMin} letters or numbers of the ${label.toLowerCase()}`
  }
]

/** A value GAS would refuse, said beside the box; null for one it takes. */
export const fieldValueError = (
  field: BucketSearchField,
  value: string
): string | null =>
  rules.find(({ breaks }) => breaks(value, field))?.says(field.label) ?? null

const kindOf = (q: string): string => q.split(':')[0]

/** A field search runs only under the choice that declares the field; an identifier or a browse under any. */
export const isOfferedSearch = (
  bucket: BucketEntry,
  filters: BucketFilters,
  q: string
): boolean =>
  !isFieldKind(kindOf(q)) || toOfferedField(bucket, filters, kindOf(q)) !== null

/** What GAS is sent for a stored search: a field's `key:value`, or the identifier's `kind:value`. */
export const toSearchParam = (q: string): { ref?: string; field?: string } =>
  isFieldKind(q)
    ? { field: q.slice(fieldKindPrefix.length) }
    : present('ref', q)
