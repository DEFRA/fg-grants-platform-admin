import type { GrantAction } from '../repositories/grants.repository.ts'

export type GrantActionRow = GrantAction

export interface GrantActionsTab {
  rows: GrantActionRow[]
  /** Some URL has the placeholder GAS fills in with its environment's name. */
  usesEnvironment: boolean
}

const environmentPlaceholder = '%ENVIRONMENT%'

/** Not `new URL`: it throws on the `%ENVIRONMENT%` hosts real definitions declare. */
const schemeHostPath =
  /^(?:((?:[a-z][a-z0-9+.-]*:)?\/\/)(?:[^/?#]*@)?)?([^/?#]*)([^?#]*)(\?[^#]*)?.*$/is

/** Each key of a query kept, its value hidden. */
const toMaskedQuery = (query: string | undefined): string =>
  query && query !== '?'
    ? `?${query
        .slice(1)
        .split('&')
        .map((pair) => (pair.includes('=') ? `${pair.split('=')[0]}=…` : pair))
        .join('&')}`
    : ''

const toAddress = (url: string): string =>
  url.replace(
    schemeHostPath,
    (_, scheme = '', host: string, path: string, query?: string) =>
      `${scheme}${host}${path}${toMaskedQuery(query)}`
  )

/** Each declared action in order, its URL cut to scheme, host, path and query keys. */
export const toGrantActions = (actions: GrantAction[]): GrantActionsTab => ({
  rows: actions.map(({ name, method, url }) => ({
    name,
    method,
    url: toAddress(url)
  })),
  usesEnvironment: actions.some(({ url }) =>
    url.includes(environmentPlaceholder)
  )
})
