import type { AllowListView } from '../use-cases/get-allow-list.use-case.ts'
import {
  toAdminHref,
  toAllowListInvalidPage,
  toAllowListPage,
  toAllowListRefusalPage
} from './allow-list-page.view-model.ts'

const view: AllowListView = {
  sbi: {
    key: 'sbi',
    label: 'Single Business Identifiers (SBIs)',
    value: '106000033',
    hint: 'One per line. 1 listed.'
  },
  crn: {
    key: 'crn',
    label: 'Customer Reference Numbers (CRNs)',
    value: '',
    hint: 'One per line. 0 listed.'
  },
  errorSummary: []
}

const invalidView: AllowListView = {
  ...view,
  sbi: { ...view.sbi, value: 'bad', error: 'SBI "bad" must be 9 digits' },
  errorSummary: [
    {
      text: 'SBI "bad" must be 9 digits',
      href: '#sbi',
      attributes: { 'data-error-line': 1 }
    }
  ]
}

describe('toAdminHref', () => {
  test('links to the grant admin page', () => {
    expect(toAdminHref('woodland')).toBe('/grant-ops/grants/woodland/admin')
  })

  test('escapes the grant code', () => {
    expect(toAdminHref('wood land')).toBe('/grant-ops/grants/wood%20land/admin')
  })
})

describe('toAllowListPage', () => {
  const page = toAllowListPage('woodland', view, {
    saved: undefined,
    activeTab: undefined
  })

  test('titles the page without an error', () => {
    expect(page.pageTitle).toBe('Grant setup')
    expect(page.errorSummary).toEqual([])
  })

  test('carries the grant code and the view GAS built', () => {
    expect(page.code).toBe('woodland')
    expect(page.form).toBe(view)
  })

  test('posts the form back to the admin page', () => {
    expect(page.formAction).toBe('/grant-ops/grants/woodland/admin')
  })

  test('resets through the admin reset page', () => {
    expect(page.resetHref).toBe('/grant-ops/grants/woodland/admin/reset')
  })

  test('escapes the grant code in its hrefs', () => {
    const escaped = toAllowListPage('wood land', view, {
      saved: undefined,
      activeTab: undefined
    })

    expect(escaped.code).toBe('wood land')
    expect(escaped.formAction).toBe('/grant-ops/grants/wood%20land/admin')
    expect(escaped.resetHref).toBe('/grant-ops/grants/wood%20land/admin/reset')
  })

  const activeTabFor = (activeTab: string | undefined) =>
    toAllowListPage('woodland', view, { saved: undefined, activeTab }).activeTab

  test('opens who can apply when asked to', () => {
    expect(activeTabFor('who-can-apply')).toBe('who-can-apply')
  })

  test('opens grant setup when no tab is asked for', () => {
    expect(activeTabFor(undefined)).toBe('grant-setup')
  })

  test('opens grant setup for a tab it does not know', () => {
    expect(activeTabFor('elsewhere')).toBe('grant-setup')
  })

  test('carries the saved notice', () => {
    expect(page.saved).toBeUndefined()
    expect(
      toAllowListPage('woodland', view, {
        saved: 'Allow list saved',
        activeTab: 'who-can-apply'
      }).saved
    ).toBe('Allow list saved')
  })
})

describe('toAllowListInvalidPage', () => {
  const page = toAllowListInvalidPage('woodland', invalidView)

  test('titles the page as an error', () => {
    expect(page.pageTitle).toBe('Error: Who can apply')
  })

  test('summarises the errors GAS shaped', () => {
    expect(page.errorSummary).toBe(invalidView.errorSummary)
    expect(page.form).toBe(invalidView)
  })

  test('opens who can apply with no saved notice', () => {
    expect(page.activeTab).toBe('who-can-apply')
    expect(page.saved).toBeUndefined()
  })

  test('escapes the grant code in its hrefs', () => {
    const escaped = toAllowListInvalidPage('wood land', invalidView)

    expect(escaped.formAction).toBe('/grant-ops/grants/wood%20land/admin')
    expect(escaped.resetHref).toBe('/grant-ops/grants/wood%20land/admin/reset')
  })
})

describe('toAllowListRefusalPage', () => {
  const page = toAllowListRefusalPage('woodland', view)

  test('titles the page as an error', () => {
    expect(page.pageTitle).toBe('Error: Who can apply')
  })

  test('shows a generic message over the saved state', () => {
    expect(page.errorSummary).toEqual([
      {
        text: 'The allow list could not be saved. Check the entries and try again.'
      }
    ])
    expect(page.form).toBe(view)
  })

  test('opens who can apply with no saved notice', () => {
    expect(page.activeTab).toBe('who-can-apply')
    expect(page.saved).toBeUndefined()
  })

  test('escapes the grant code in its hrefs', () => {
    const escaped = toAllowListRefusalPage('wood land', view)

    expect(escaped.formAction).toBe('/grant-ops/grants/wood%20land/admin')
    expect(escaped.resetHref).toBe('/grant-ops/grants/wood%20land/admin/reset')
  })
})
