import { assets } from './assets.ts'
import { getSessionRoles } from '../auth/session.ts'
import type { ViewContextRequest } from './index.ts'

// Role names are copied, as in home/routes/view-root.route.
const areas = [
  {
    text: 'Operations Admin',
    href: '/dev-ops',
    role: 'FCP.GrantOperationsAdmin'
  },
  {
    text: 'Applications Admin',
    href: '/grant-ops',
    role: 'FCP.GrantApplicationsAdmin'
  }
]

// Only the areas the user can open, so the nav never links into a 403.
const buildNavigation = (request?: ViewContextRequest) => {
  const roles = getSessionRoles(request ?? {})

  return areas
    .filter(({ role }) => roles.includes(role))
    .map(({ text, href }) => ({
      text,
      href,
      current: request?.path === href
    }))
}

export const context = async (request?: ViewContextRequest) => ({
  ...(await assets()),
  // Not config's serviceName, which names the deployment for logs and CDP.
  serviceName: 'Grants Platform Administration',
  breadcrumbs: [] as { text: string; href?: string }[],
  navigation: buildNavigation(request)
})
