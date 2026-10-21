import { render } from '../../../test-utils.ts'

const address = (url: string | null) =>
  render('service-address', { url, service: 'LAND_DATA', testId: 'calls' })

describe('service-address component', () => {
  test('shows the address in mono, with the service beneath it', () => {
    const $ = address('https://land-data.example/api/v2/parcels/{sbi}')

    expect($('[data-testid="calls-url"]').text()).toBe(
      'https://land-data.example/api/v2/parcels/{sbi}'
    )
    expect($('[data-testid="calls-url"]').attr('class')).toContain('font-mono')
    expect($('[data-testid="calls-not-configured"]')).toHaveLength(0)
    expect($('[data-testid="calls-service"]').text()).toBe('LAND_DATA')
    expect($('[data-testid="calls-service"]').attr('class')).toBe(
      'mt-1 font-mono text-xs text-base-content/60'
    )
  })

  test('says Not configured with a warning dot when the environment has no address', () => {
    const $ = address(null)

    expect($('[data-testid="calls-url"]')).toHaveLength(0)
    expect($('[data-testid="do-status-label"]').text()).toBe('Not configured')
    expect(
      $('[data-testid="calls-not-configured"]').children().attr('title')
    ).toBe('Not configured')
    expect($('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-warning'
    )
    expect($('[data-testid="calls-service"]').text()).toBe('LAND_DATA')
  })

  test('escapes markup in an address', () => {
    const $ = address('https://h/<b>x</b>')

    expect($('[data-testid="calls-url"]').text()).toBe('https://h/<b>x</b>')
    expect($('[data-testid="calls-url"] b')).toHaveLength(0)
  })
})
