const defaultTab = 'grant-setup'

/** The tab the server chose, unless it's the one GOV.UK Tabs selects anyway. */
const chosenTab = (tabs: HTMLElement): string | undefined => {
  const { activeTab } = tabs.dataset

  return !window.location.hash && activeTab && activeTab !== defaultTab
    ? activeTab
    : undefined
}

const selectInitialTab = (tabs: HTMLElement): void => {
  // GOV.UK Tabs reads the fragment during initialisation. Remove our temporary
  // fragment immediately afterwards so it cannot trigger load-time scrolling.
  if (tabs.dataset.initialTabFragment) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`
    )
    delete tabs.dataset.initialTabFragment
    return
  }

  const tab = chosenTab(tabs)

  if (!tab) {
    return
  }

  tabs.dataset.initialTabFragment = tab
  window.history.replaceState(null, '', `#${tab}`)
}

export const selectDefaultAllowListTab = (
  root: ParentNode = document
): void => {
  const tabs = root.querySelector<HTMLElement>('[data-active-tab]')
  if (tabs) {
    selectInitialTab(tabs)
  }
}
