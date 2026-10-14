// @vitest-environment happy-dom
import { createAll, Tabs } from 'govuk-frontend'
import { selectDefaultAllowListTab } from './allow-list-tabs.ts'

const tabsMarkup = `
  <div class="govuk-tabs" data-module="govuk-tabs" data-active-tab="grant-setup">
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
  const tabs = createAll(Tabs)
  selectDefaultAllowListTab()
  return tabs
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

  test('opens Grant setup without adding a fragment on normal entry', () => {
    initialiseRealTabs()

    expect(window.location.hash).toBe('')
    expect(
      document
        .querySelector('a[href="#grant-setup"]')
        ?.getAttribute('aria-selected')
    ).toBe('true')
  })

  test('keeps Who can apply selected without leaving a scrolling fragment after saving', () => {
    document.querySelector<HTMLElement>(
      '[data-active-tab]'
    )!.dataset.activeTab = 'who-can-apply'
    initialiseRealTabs()

    expect(window.location.hash).toBe('')
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

  test('removes the default fragment after selecting the error tab', () => {
    document.querySelector<HTMLElement>(
      '[data-active-tab]'
    )!.dataset.activeTab = 'who-can-apply'
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="govuk-error-summary"></div>'
    )

    initialiseRealTabs()

    expect(window.location.hash).toBe('')
    expect(
      document
        .querySelector('a[href="#who-can-apply"]')
        ?.getAttribute('aria-selected')
    ).toBe('true')
  })

  test('does not change the URL on a page without allow-list tabs', () => {
    document.body.innerHTML = '<main>Another page</main>'

    selectDefaultAllowListTab()

    expect(window.location.hash).toBe('')
  })
})
