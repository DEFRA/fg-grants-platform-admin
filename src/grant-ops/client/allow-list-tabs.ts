const canSelectDefault = (defaultTab?: string): defaultTab is string =>
  !window.location.hash && Boolean(defaultTab)

const shouldClearErrorFragment = (
  root: ParentNode,
  tabs: HTMLElement | null,
  defaultTab?: string
): boolean =>
  Boolean(tabs?.hasAttribute('data-govuk-tabs-init')) &&
  Boolean(root.querySelector('.govuk-error-summary')) &&
  window.location.hash === defaultTab

const defaultTabFor = (tabs: HTMLElement | null): string | undefined =>
  tabs?.dataset.defaultTab

export const selectDefaultAllowListTab = (
  root: ParentNode = document
): void => {
  const tabs = root.querySelector<HTMLElement>('[data-default-tab]')
  const defaultTab = defaultTabFor(tabs)

  if (shouldClearErrorFragment(root, tabs, defaultTab)) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`
    )
    return
  }

  if (!canSelectDefault(defaultTab)) {
    return
  }

  window.history.replaceState(null, '', defaultTab)
}
