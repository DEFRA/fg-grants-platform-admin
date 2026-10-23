import { toGrantActions } from './grant-actions.ts'

const action = (url: string, name = 'parcels', method = 'GET') => ({
  name,
  method,
  url
})

const addressOf = (url: string) => toGrantActions([action(url)]).rows[0].url

describe('toGrantActions', () => {
  test('keeps the declared order, duplicates included', () => {
    const actions = [
      action('https://a.example/one', 'calculate', 'POST'),
      action('https://a.example/two', 'parcels', 'GET'),
      action('https://a.example/three', 'calculate', 'POST')
    ]

    expect(toGrantActions(actions).rows).toEqual(actions)
  })

  test('has no rows for a grant with no actions', () => {
    expect(toGrantActions([])).toEqual({ rows: [], usesEnvironment: false })
  })

  test('shows a method other than GET or POST as stored', () => {
    expect(
      toGrantActions([action('https://a.example', 'x', 'delete')]).rows[0]
        .method
    ).toBe('delete')
  })

  test('says when a URL has the environment placeholder GAS fills in', () => {
    expect(
      toGrantActions([
        action('https://a.example/x'),
        action('https://qa-land.%ENVIRONMENT%.example.test/parcels/$sbi')
      ]).usesEnvironment
    ).toBe(true)
    expect(
      toGrantActions([action('https://a.example/x')]).usesEnvironment
    ).toBe(false)
  })

  test.each([
    ['https://user:pw@host:8443/a/b?x=1#f', 'https://host:8443/a/b?x=…'],
    ['HTTPS://user:pw@host/a', 'HTTPS://host/a'],
    ['https://u:p@ss@host/p', 'https://host/p'],
    ['https://h/a@b/c', 'https://h/a@b/c'],
    [
      'https://qa-user:not-a-real-secret@qa-eligibility.example.test/eligibility/$sbi/$crn',
      'https://qa-eligibility.example.test/eligibility/$sbi/$crn'
    ],
    ['//u:p@host/path?q#f', '//host/path?q'],
    ['//u:p@ss@host:8443/p', '//host:8443/p'],
    ['//host/path', '//host/path'],
    ['https://host?x=1', 'https://host?x=…'],
    [
      'https://qa-items.example.test/items?scheme=qa-complex&limit=10',
      'https://qa-items.example.test/items?scheme=…&limit=…'
    ],
    ['https://host/p?', 'https://host/p'],
    [
      'https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/grantFundingCalculator',
      'https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/grantFundingCalculator'
    ],
    [
      'https://land-data.%ENVIRONMENT%.example/parcels/$sbi?code=x',
      'https://land-data.%ENVIRONMENT%.example/parcels/$sbi?code=…'
    ],
    ['land-data/parcels?x=1', 'land-data/parcels?x=…'],
    ['land-data/parcels#top', 'land-data/parcels']
  ])('shows %s as %s', (url, shown) => {
    expect(addressOf(url)).toBe(shown)
  })
})
