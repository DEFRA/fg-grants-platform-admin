export interface FilterField {
  name: string
  value: string
}

/** The keys a list's links can carry, read off its own query type. */
export type FilterKeys<Q> = readonly (keyof Q & string)[]

export const present = (name: string, value: string | undefined) =>
  value ? { [name]: value } : {}

export const toFields = <Q extends object>(
  query: Q,
  keys: FilterKeys<Q>
): FilterField[] =>
  keys.flatMap((name) => {
    const value = query[name]

    return typeof value === 'string' && value !== '' ? [{ name, value }] : []
  })

/** A list's link with every filter it holds; `params` goes first, as the cursor does. */
export const toFilterHref = <Q extends object>(
  basePath: string,
  keys: FilterKeys<Q>,
  query: Q,
  params: URLSearchParams = new URLSearchParams()
): string => {
  for (const { name, value } of toFields(query, keys)) {
    params.set(name, value)
  }

  return params.size ? `${basePath}?${params}` : basePath
}
