import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Operations Admin',
        href: '/operations-admin'
      },
      {
        current: false,
        text: 'Applications Admin',
        href: '/applications-admin'
      }
    ])
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/' }))).toEqual([
      {
        current: true,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Operations Admin',
        href: '/operations-admin'
      },
      {
        current: false,
        text: 'Applications Admin',
        href: '/applications-admin'
      }
    ])
  })

  test('Should highlight the operations admin navigation item', () => {
    expect(buildNavigation(mockRequest({ path: '/operations-admin' }))).toEqual(
      [
        {
          current: false,
          text: 'Home',
          href: '/'
        },
        {
          current: true,
          text: 'Operations Admin',
          href: '/operations-admin'
        },
        {
          current: false,
          text: 'Applications Admin',
          href: '/applications-admin'
        }
      ]
    )
  })

  test('Should highlight the applications admin navigation item', () => {
    expect(
      buildNavigation(mockRequest({ path: '/applications-admin' }))
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Operations Admin',
        href: '/operations-admin'
      },
      {
        current: true,
        text: 'Applications Admin',
        href: '/applications-admin'
      }
    ])
  })
})
