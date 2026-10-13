const shouldSelectAllowList = (tabs: HTMLElement): boolean =>
  !window.location.hash && tabs.dataset.activeTab === 'who-can-apply'

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

  if (!shouldSelectAllowList(tabs)) {
    return
  }

  tabs.dataset.initialTabFragment = 'who-can-apply'
  window.history.replaceState(null, '', '#who-can-apply')
}

export const selectDefaultAllowListTab = (
  root: ParentNode = document
): void => {
  const tabs = root.querySelector<HTMLElement>('[data-active-tab]')
  if (tabs) {
    selectInitialTab(tabs)
  }
}
