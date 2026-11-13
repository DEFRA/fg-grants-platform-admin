import { place, unplace } from '../../../core/floating.ts'
import type { Placement } from '../../../core/floating.ts'

const itemSelector =
  '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])'

interface Parts {
  panel: HTMLElement
  trigger: HTMLElement
}

/** Where each key moves focus, from the item that has it (-1 for none). */
const moves: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at, count) => (at < 0 ? count - 1 : at - 1),
  Home: () => 0,
  End: (_at, count) => count - 1
}

const show = (item: HTMLElement | undefined) => {
  item?.focus()
  item?.scrollIntoView?.({ block: 'nearest' })
}

/** The popover, a child of the element, and the button that opens it, anywhere in it (a Select wraps its own). */
const partsOf = (element: HTMLElement): Parts | null => {
  const panel = element.querySelector<HTMLElement>(':scope > [popover][id]')

  if (!panel) {
    return null
  }

  const trigger = element.querySelector<HTMLElement>(
    `[popovertarget="${CSS.escape(panel.id)}"]`
  )

  return trigger ? { panel, trigger } : null
}

/**
 * Enhances a dropdown (FilterChip, AccountMenu, any menu) drawn as a button and
 * a popover: the menu already opens, closes on Escape and outside clicks, and
 * sits in the top layer without this.
 *
 * Open, it places the menu against its trigger, flipped when that side has no
 * room and held inside the window, and keeps it there on scroll and resize; moves
 * focus through the items with the arrow keys, Home and End, starting on the
 * checked item; and closes on Tab, as a menu does.
 */
export class AuDropdown extends HTMLElement {
  #parts: Parts | null = null

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    this.#unlisten()
  }

  enhance() {
    const parts = this.#parts ? null : partsOf(this)

    if (!parts) {
      return
    }
    this.#parts = parts
    parts.trigger.setAttribute('aria-expanded', 'false')
    for (const item of this.#items()) {
      item.tabIndex = -1
    }
    // beforetoggle comes as the menu opens; the animation frame it asks for runs before the next paint, by when the
    // menu is open and can be measured, so it is placed before its first frame. (The toggle event comes a task
    // later, after a frame drawn in the corner.) A browser without beforetoggle falls back to toggle.
    parts.panel.addEventListener('onbeforetoggle' in HTMLElement.prototype ? 'beforetoggle' : 'toggle', this.#onToggle)
    parts.panel.addEventListener('keydown', this.#onKey)
    // A menu item cut short with an ellipsis shows its whole text on hover.
    parts.panel.addEventListener('pointerover', (event) => {
      const label = (event.target as Element).closest?.('.au-menuitem-label') as HTMLElement | null
      if (label && label.scrollWidth > label.clientWidth + 1) label.title = label.textContent?.trim() ?? ''
    })
  }

  get open() {
    return Boolean(this.#parts?.panel.matches(':popover-open'))
  }

  close(refocus?: boolean) {
    const parts = this.open ? this.#parts : null

    if (!parts) {
      return
    }
    parts.panel.hidePopover()
    if (refocus) {
      parts.trigger.focus()
    }
  }

  #items = (): HTMLElement[] => [
    ...(this.#parts?.panel.querySelectorAll<HTMLElement>(itemSelector) ?? [])
  ]

  #onToggle = (event: Event) => {
    if ((event as ToggleEvent).newState === 'open') {
      requestAnimationFrame(() => {
        if (this.open) this.#opened()
      })
    } else {
      this.#closed()
    }
  }

  #opened() {
    const items = this.#items()

    this.#parts?.trigger.setAttribute('aria-expanded', 'true')
    this.#reposition()
    window.addEventListener('scroll', this.#reposition, true)
    window.addEventListener('resize', this.#reposition)
    show(
      items.find((item) => item.getAttribute('aria-checked') === 'true') ??
        items[0]
    )
  }

  #closed() {
    this.#parts?.trigger.setAttribute('aria-expanded', 'false')
    if (this.#parts) {
      unplace(this.#parts.panel)
    }
    this.#unlisten()
  }

  #unlisten() {
    window.removeEventListener('scroll', this.#reposition, true)
    window.removeEventListener('resize', this.#reposition)
  }

  #placement(): Placement {
    return {
      side: this.dataset.placement === 'top' ? 'top' : 'bottom',
      align: this.dataset.align === 'end' ? 'end' : 'start'
    }
  }

  #reposition = () => {
    const parts = this.open ? this.#parts : null

    if (parts) {
      place(parts.trigger, parts.panel, this.#placement())
    }
  }

  #onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      this.close()
      return
    }

    const move = moves[event.key]
    const items = this.#items()

    if (!move || !items.length) {
      return
    }
    event.preventDefault()

    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = move(at, items.length)

    show(items[Math.max(0, Math.min(next, items.length - 1))])
  }
}
