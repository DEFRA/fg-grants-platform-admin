import { assets } from './assets.ts'
import type { ViewContextRequest } from './index.ts'
import { config } from '../../../common/config.ts'

const buildNavigation = (request?: ViewContextRequest) => [
  {
    text: 'Operations Admin',
    href: '/dev-ops',
    current: request?.path === '/dev-ops'
  },
  {
    text: 'Applications Admin',
    href: '/grant-ops',
    current: request?.path === '/grant-ops'
  }
]

export const context = async (request?: ViewContextRequest) => ({
  ...(await assets()),
  serviceName: config.get('serviceName'),
  serviceUrl: '/',
  breadcrumbs: [] as { text: string; href?: string }[],
  navigation: buildNavigation(request)
})
