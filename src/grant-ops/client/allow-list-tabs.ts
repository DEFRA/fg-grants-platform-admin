const canSelectDefault = (defaultTab?: string): defaultTab is string =>
  !window.location.hash && Boolean(defaultTab)

export const selectDefaultAllowListTab = (
  root: ParentNode = document
): void => {
  const tabs = root.querySelector<HTMLElement>('[data-default-tab]')
  const defaultTab = tabs?.dataset.defaultTab

  if (!canSelectDefault(defaultTab)) {
    return
  }

  window.history.replaceState(null, '', defaultTab)
}
