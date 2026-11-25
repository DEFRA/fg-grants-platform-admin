export type Upgrade = (root: ParentNode) => void

const bannerId = 'event-banner'

/** What follows the tabs: the tab's panel, and Details beside it. */
const panelOf = (page: Element): Element[] => {
  const children = [...page.children]
  const tabs = children.findIndex((child) => child.matches('.gpa-tabs'))

  return children.slice(tabs + 1)
}

const anchorablesOf = (page: Element): Element[] =>
  panelOf(page).flatMap((region) => [
    region,
    ...region.querySelectorAll('[id], [data-testid]')
  ])

interface Anchor {
  scroller: Element
  id: string
  index: number
  top: number
}

const topOf = (element: Element) => element.getBoundingClientRect().top

const nearer = (best: Anchor | null, anchor: Anchor): Anchor =>
  best && Math.abs(best.top) <= Math.abs(anchor.top) ? best : anchor

/** What the page scrolls in: the shell's main column, or the document on a narrow screen. */
const scrolledOf = (page: Element): Element | null => {
  for (let at = page.parentElement; at; at = at.parentElement) {
    if (at.scrollTop > 0) return at
  }

  return null
}

/** Where the operator is reading: the element nearest the viewport's top. At the top of the page, the page stays there. */
const toAnchor = (page: Element): Anchor | null => {
  const scroller = scrolledOf(page)

  return (
    scroller &&
    anchorablesOf(page).reduce<Anchor | null>(
      (best, element, index) =>
        nearer(best, { scroller, id: element.id, index, top: topOf(element) }),
      null
    )
  )
}

/** New entries land above what the operator is reading, so the view moves with it. */
const keepAnchor = (page: Element, anchor: Anchor | null) => {
  const found =
    anchor && (anchor.id ? document.getElementById(anchor.id) : null)
  const element = found ?? (anchor && anchorablesOf(page)[anchor.index])

  if (anchor && element) {
    anchor.scroller.scrollBy(0, topOf(element) - anchor.top)
  }
}

const imported = (nodes: Element[]): Element[] =>
  nodes.map((node) => document.importNode(node, true))

const takeBanner = (incoming: Element[]) => {
  const at = incoming.findIndex(({ id }) => id === bannerId)

  return {
    before: at === -1 ? incoming : incoming.slice(0, at),
    next: at === -1 ? null : incoming[at],
    after: at === -1 ? [] : incoming.slice(at + 1)
  }
}

/** The banner is never replaced: it is the page's one status region, so its text changes once, in place. */
const swapPage = (page: Element, next: Element, banner: HTMLElement) => {
  const {
    before,
    next: nextBanner,
    after
  } = takeBanner(imported([...next.children]))

  for (const child of [...page.children]) {
    if (child !== banner) child.remove()
  }

  banner.before(...before)
  banner.after(...after)

  if (nextBanner) {
    banner.className = nextBanner.className
    banner.replaceChildren(...nextBanner.childNodes)
  } else {
    banner.remove()
  }

  return [...before, ...after]
}

const swapDialogs = (record: Element, next: Element, page: Element) => {
  const incoming = imported(
    [...next.children].filter((child) => !child.matches('.gpa-page'))
  )

  for (const child of [...record.children]) {
    if (child !== page) child.remove()
  }

  record.append(...incoming)

  return incoming
}

const byTestId = (record: Element, testId: string | null) =>
  testId
    ? record.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`)
    : null

/** A copy button copies what it did and a link goes where it went; anything else reads as it did. Only a single match counts. */
const identityOf = (element: Element): string => {
  const copies = element.closest('gpa-copy')?.getAttribute('data-value')
  const href = element.getAttribute('href')

  if (copies != null) return JSON.stringify(['copies', copies])
  if (href !== null) return JSON.stringify(['href', href])

  return JSON.stringify([
    element.tagName,
    element.getAttribute('aria-label'),
    element.textContent
  ])
}

const byLook = (record: Element, focused: HTMLElement) => {
  const identity = identityOf(focused)
  const matches = [
    ...record.querySelectorAll<HTMLElement>(focused.tagName)
  ].filter((element) => identityOf(element) === identity)

  return matches.length === 1 ? matches[0] : null
}

const counterpartOf = (record: Element, focused: HTMLElement) =>
  (focused.id ? document.getElementById(focused.id) : null) ??
  byTestId(record, focused.getAttribute('data-testid')) ??
  byLook(record, focused)

const focusHeading = (record: Element) => {
  const heading = record.querySelector<HTMLElement>('h1')

  if (heading) {
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }
}

/** Focus that was on something swapped out goes to its counterpart, or to the heading when it has none. Focus on the banner stays with the browser. */
const keepFocus = (record: Element, focused: Element | null) => {
  if (!(focused instanceof HTMLElement) || focused.isConnected) return

  const counterpart = counterpartOf(record, focused)

  if (counterpart) {
    counterpart.focus({ preventScroll: true })
  } else {
    focusHeading(record)
  }
}

const deliver = (next: Document) => {
  const toast = next.querySelector('gpa-toast')
  const region = document.querySelector('.gpa-toast-region')

  if (toast && region) region.append(document.importNode(toast, true))
}

/** The header, the tabs, the tab's panel and the dialogs as the result draws them; the banner says how it went. */
const recordOf = (root: Document) => {
  const record = root.getElementById('event-record')
  const page = record?.querySelector(':scope > .gpa-page')

  return record && page ? { record, page } : null
}

export const swapIn = (
  next: Document,
  banner: HTMLElement,
  upgrade: Upgrade
) => {
  const current = recordOf(document)
  const incoming = recordOf(next)

  if (!current || !incoming) return

  const { record, page } = current
  const focused = banner.contains(document.activeElement)
    ? null
    : document.activeElement
  const anchor = toAnchor(page)
  const swapped = [
    ...swapPage(page, incoming.page, banner),
    ...swapDialogs(record, incoming.record, page)
  ]

  deliver(next)

  for (const region of swapped) upgrade(region)
  if (banner.isConnected) upgrade(banner)

  keepAnchor(page, anchor)
  keepFocus(record, focused)
}
