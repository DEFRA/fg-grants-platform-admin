import type { GrantAction } from '../repositories/grants.repository.ts'

export type GrantActionRow = GrantAction

/** Not `new URL`: it throws on the `%ENVIRONMENT%` hosts real definitions declare. */
const schemeHostPath =
  /^(?:((?:[a-z][a-z0-9+.-]*:)?\/\/)(?:[^/?#]*@)?)?([^/?#]*)([^?#]*).*$/is

const toAddress = (url: string): string => url.replace(schemeHostPath, '$1$2$3')

/** Each declared action in order, its URL cut to scheme, host and path. */
export const toGrantActions = (actions: GrantAction[]): GrantActionRow[] =>
  actions.map(({ name, method, url }) => ({
    name,
    method,
    url: toAddress(url)
  }))
