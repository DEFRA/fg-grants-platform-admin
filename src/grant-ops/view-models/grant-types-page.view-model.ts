import type { GrantType } from '../use-cases/get-grant-types.use-case.ts'
import { toAdminHref } from './allow-list-page.view-model.ts'

const heading = 'Grant Types'

/** Shown in every row until GAS holds a grant status. */
const statusPlaceholder = '[Status]'

export interface GrantTypeRow {
  code: string
  href: string
  name: string
  status: string
}

export interface GrantTypesPage {
  pageTitle: string
  heading: string
  rows: GrantTypeRow[]
}

const toRow = ({ code, name }: GrantType): GrantTypeRow => ({
  code,
  href: toAdminHref(code),
  name: name ?? '',
  status: statusPlaceholder
})

export const toGrantTypesPage = (grantTypes: GrantType[]): GrantTypesPage => ({
  pageTitle: heading,
  heading,
  rows: grantTypes.map(toRow)
})
