export function buildNavigation(request?: { path?: string }) {
  return [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Operations Admin',
      href: '/operations-admin',
      current: request?.path === '/operations-admin'
    },
    {
      text: 'Applications Admin',
      href: '/applications-admin',
      current: request?.path === '/applications-admin'
    }
  ]
}
