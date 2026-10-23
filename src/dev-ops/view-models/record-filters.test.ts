import { fromMax, toFittingBack } from './record-filters.ts'

describe('toFittingBack', () => {
  const nest = (depth: number, list: string): string =>
    depth === 0
      ? list
      : `/dev-ops/grants/woodland/1.${depth}.0?tab=phases&back=${encodeURIComponent(nest(depth - 1, list))}`

  test('leaves a back that fits as it is', () => {
    const back = nest(2, '/dev-ops/grants?grant=woodland')

    expect(toFittingBack(back)).toBe(back)
  })

  test('drops the innermost back first until the whole fits', () => {
    const long = nest(3, `/dev-ops/grants?grant=${'x'.repeat(fromMax)}`)
    const fitted = toFittingBack(long)

    expect(long.length).toBeGreaterThan(fromMax)
    expect(fitted).toBe(
      `/dev-ops/grants/woodland/1.3.0?tab=phases&back=${encodeURIComponent(
        `/dev-ops/grants/woodland/1.2.0?tab=phases&back=${encodeURIComponent('/dev-ops/grants/woodland/1.1.0?tab=phases')}`
      )}`
    )
  })

  test('keeps the query of an innermost page whose params only end in back', () => {
    const inner = `/dev-ops/applications?feedback=${'x'.repeat(fromMax)}&grant=woodland`
    const long = `/dev-ops/grants/woodland/1.2.0?tab=phases&back=${encodeURIComponent(inner)}`

    expect(toFittingBack(long)).toBe(
      '/dev-ops/grants/woodland/1.2.0?tab=phases'
    )
  })
})
