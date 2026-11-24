import type { HomeData } from '../use-cases/get-home.use-case.ts'

const heading = 'Manage grants'

/** Until the Grant Applications page exists. */
const grantApplicationsHref = '#'

export interface HomeCard {
  id: string
  title: string
  href: string
  description?: string
}

export interface HomePage {
  pageTitle: string
  heading: string
  name: string
  cards: HomeCard[]
}

const toGrantTypesDescription = (grantTypeCount: number | null): string =>
  grantTypeCount === null
    ? 'Browse the grant schemes and manage scheme parameters'
    : `Browse the ${grantTypeCount} grant schemes and manage scheme parameters`

export const toHomePage = (
  { grantTypeCount }: HomeData,
  name: string
): HomePage => ({
  pageTitle: heading,
  heading,
  name,
  cards: [
    {
      id: 'grant-types',
      title: 'Grant types',
      href: '/grant-ops/grants',
      description: toGrantTypesDescription(grantTypeCount)
    },
    {
      id: 'grant-applications',
      title: 'Grant applications',
      href: grantApplicationsHref
    }
  ]
})
