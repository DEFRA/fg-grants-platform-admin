// @vitest-environment happy-dom
import { createAll, Tabs } from 'govuk-frontend'
import { selectDefaultAllowListTab } from './allow-list-tabs.ts'

const tabsMarkup = `
  <div class="govuk-tabs" data-module="govuk-tabs" data-default-tab="#who-can-apply">
    <ul class="govuk-tabs__list">
      <li class="govuk-tabs__list-item">
        <a class="govuk-tabs__tab" href="#grant-setup">Grant setup</a>
      </li>
      <li class="govuk-tabs__list-item govuk-tabs__list-item--selected">
        <a class="govuk-tabs__tab" href="#who-can-apply">Who can apply</a>
      </li>
    </ul>
    <div class="govuk-tabs__panel" id="grant-setup"></div>
    <div class="govuk-tabs__panel" id="who-can-apply">Allow-list form</div>
  </div>
`

const initialiseRealTabs = () => {
  selectDefaultAllowListTab()
  return createAll(Tabs)
}

describe('selectDefaultAllowListTab', () => {
  beforeEach(() => {
    document.body.className = 'govuk-frontend-supported'
    document.body.innerHTML = tabsMarkup
    document.documentElement.style.setProperty(
      '--govuk-breakpoint-tablet',
      '40.0625em'
    )
    window.history.replaceState(null, '', '/grant-ops/grants/woodland/admin')
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('keeps Who can apply selected when real GOV.UK Tabs initialises', () => {
    initialiseRealTabs()

    expect(window.location.hash).toBe('#who-can-apply')
    expect(
      document
        .querySelector('a[href="#who-can-apply"]')
        ?.getAttribute('aria-selected')
    ).toBe('true')
    expect(
      document
        .querySelector('#who-can-apply')
        ?.classList.contains('govuk-tabs__panel--hidden')
    ).toBe(false)
    expect(
      document
        .querySelector('#grant-setup')
        ?.classList.contains('govuk-tabs__panel--hidden')
    ).toBe(true)
  })

  test('does not override an existing tab fragment', () => {
    window.history.replaceState(
      null,
      '',
      '/grant-ops/grants/woodland/admin#grant-setup'
    )

    initialiseRealTabs()

    expect(window.location.hash).toBe('#grant-setup')
    expect(
      document
        .querySelector('a[href="#grant-setup"]')
        ?.getAttribute('aria-selected')
    ).toBe('true')
  })

  test('does not change the URL on a page without allow-list tabs', () => {
    document.body.innerHTML = '<main>Another page</main>'

    selectDefaultAllowListTab()

    expect(window.location.hash).toBe('')
  })
})
