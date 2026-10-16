import { toEventKey, toUrlService } from './event-address.ts'

const id = '665f1c2e9a1b2c3d4e5f6a7b'

describe('the event address', () => {
  test.each([
    ['gas', 'gas'],
    ['caseworking', 'cw']
  ] as const)('spells %s as %s', (service, spelled) => {
    expect(toUrlService(service)).toBe(spelled)
  })

  test.each([
    ['gas', 'gas'],
    ['cw', 'caseworking']
  ])('reads %s back as %s', (spelled, service) => {
    expect(toEventKey({ service: spelled, box: 'inbox', id })).toEqual({
      service,
      box: 'inbox',
      id
    })
  })
})
