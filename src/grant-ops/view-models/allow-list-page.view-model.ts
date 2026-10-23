import type { AllowListView } from '../use-cases/get-allow-list.use-case.ts'

export const allowListSavedKey = 'allowListSaved'
export const allowListActiveTabKey = 'allowListActiveTab'

type AllowListTab = 'grant-setup' | 'who-can-apply'

interface ErrorSummaryItem {
  text: string
  href?: string
  attributes?: { 'data-error-line': number }
}

export interface AllowListPage {
  activeTab: AllowListTab
  code: string
  pageTitle: string
  formAction: string
  form: AllowListView
  errorSummary: ErrorSummaryItem[]
  resetHref: string
  saved: string | undefined
}

export const toAdminHref = (code: string): string =>
  `/grant-ops/grants/${encodeURIComponent(code)}/admin`

const toResetHref = (code: string): string => `${toAdminHref(code)}/reset`

const saveRefusalSummary = [
  {
    text: 'The allow list could not be saved. Check the entries and try again.'
  }
]

interface PageOptions {
  activeTab: AllowListTab
  code: string
  view: AllowListView
  errorSummary: ErrorSummaryItem[]
  saved: string | undefined
}

const toPage = ({
  activeTab,
  code,
  view,
  errorSummary,
  saved
}: PageOptions): AllowListPage => ({
  activeTab,
  code,
  pageTitle: `${errorSummary.length ? 'Error: ' : ''}${activeTab === 'grant-setup' ? 'Grant setup' : 'Who can apply'}`,
  formAction: toAdminHref(code),
  form: view,
  errorSummary,
  resetHref: toResetHref(code),
  saved
})

const toActiveTab = (activeTab: string | undefined): AllowListTab =>
  activeTab === 'who-can-apply' ? activeTab : 'grant-setup'

export const toAllowListPage = (
  code: string,
  view: AllowListView,
  {
    saved,
    activeTab
  }: { saved: string | undefined; activeTab: string | undefined }
): AllowListPage =>
  toPage({
    activeTab: toActiveTab(activeTab),
    code,
    view,
    errorSummary: [],
    saved
  })

export const toAllowListInvalidPage = (
  code: string,
  view: AllowListView
): AllowListPage =>
  toPage({
    activeTab: 'who-can-apply',
    code,
    view,
    errorSummary: view.errorSummary,
    saved: undefined
  })

export const toAllowListRefusalPage = (
  code: string,
  view: AllowListView
): AllowListPage =>
  toPage({
    activeTab: 'who-can-apply',
    code,
    view,
    errorSummary: saveRefusalSummary,
    saved: undefined
  })
