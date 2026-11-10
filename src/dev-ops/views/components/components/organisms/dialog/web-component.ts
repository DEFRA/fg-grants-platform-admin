const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // No matchMedia (a test DOM): animate.
    return false
  }
}

/** The exit animation's length, from its token; none when motion is reduced. */
const exitMs = (): number => {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--duration-exit'
    )
  )

  if (reducedMotion()) {
    return 0
  }

  return Number.isNaN(value) ? 150 : value
}

/** The dialog an `[data-au-open]` names, by way of the element that enhances it. */
const hostOf = (opener: HTMLElement): AuDialog | null =>
  document
    .getElementById(opener.dataset.auOpen ?? '')
    ?.closest<AuDialog>('au-dialog') ?? null

const onPageClick = (event: MouseEvent) => {
  const opener = (event.target as Element).closest?.<HTMLElement>(
    '[data-au-open]'
  )
  const host = opener && hostOf(opener)

  if (host) {
    event.preventDefault()
    host.show(opener)
  }
}

/**
 * Enhances a Dialog or Drawer drawn as a native <dialog>.
 *
 * Opens it with showModal(), so the browser traps focus, makes the page inert
 * and closes on Escape, from any [data-au-open="<dialog id>"] on the page, or
 * on arrival when it carries `data-open` (a form handed back with its errors).
 * Every way of closing (its close button, Escape, a click on the backdrop, a
 * [data-au-close]) plays the exit animation first. Focus returns to the opener, or, when the opener sat in a menu
 * that has closed since, to that menu's trigger.
 *
 * A dialog the server drew open (`data-open`: the page's address opened it, say `?times=open`) puts the address back
 * to its close link (`closeHref`, the × link) when it closes, with history.replaceState, so a reload or Back doesn't
 * open it again. Only a same-origin link is used, and only once.
 *
 * With `data-reset-on-open` (resetOnOpen), each time it's opened from the page its forms go back to what the server
 * drew (form.reset()); then each field fires `input`, so counts and
 * a confirm's typed-text check follow. Not on arrival: a form handed back with its errors keeps what was typed.
 */
export class AuDialog extends HTMLElement {
  #dialog: HTMLDialogElement | null = null
  #opener: HTMLElement | null = null
  #arrived = false

  static #listening = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
    if (!AuDialog.#listening) {
      AuDialog.#listening = true
      document.addEventListener('click', onPageClick)
    }
  }

  enhance() {
    const dialog = this.#dialog
      ? null
      : this.querySelector<HTMLDialogElement>(':scope > dialog')

    if (!dialog) {
      return
    }
    this.#dialog = dialog
    dialog.addEventListener('cancel', this.#onCancel)
    dialog.addEventListener('click', this.#onClick)
    if (this.hasAttribute('data-open')) {
      this.#arrived = true
      this.show()
    }
  }

  get #dismissible() {
    return this.dataset.dismissible !== 'false'
  }

  #onCancel = (event: Event) => {
    event.preventDefault()
    if (this.#dismissible) this.hide()
  }

  /** The overlay (a div behind the panel) and anything marked [data-au-close] close it. */
  #onClick = (event: MouseEvent) => {
    const target = event.target as Element

    if (target.closest('[data-au-close]') && this.#dismissible) {
      event.preventDefault()
      this.hide()
    }
  }

  #reset(dialog: HTMLDialogElement) {
    const forms = new Set<HTMLFormElement>(dialog.querySelectorAll('form'))
    for (const field of dialog.querySelectorAll<HTMLInputElement>('input, select, textarea, button')) if (field.form) forms.add(field.form)
    for (const form of forms) {
      form.reset()
      for (const field of form.elements) if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  /**
   * Focus back to what opened it. An opener inside a menu or popover that has closed since (an AccountMenu item) is
   * hidden, so focus goes to that menu's trigger instead, never to <body>.
   */
  #returnFocus() {
    const opener = this.#opener
    if (!opener?.isConnected) return
    const panel = opener.closest<HTMLElement>('[popover][id]')
    const shut = panel && !panel.matches(':popover-open')
    const hidden = typeof opener.checkVisibility === 'function' ? !opener.checkVisibility() : opener.offsetParent === null
    if (panel && (shut || hidden)) {
      const trigger = document.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(panel.id)}"]`)
      if (trigger) {
        trigger.focus()
        return
      }
    }
    opener.focus()
  }

  /** Back to the address the close link names (a server-opened dialog's way out), without a reload. */
  #restoreAddress(dialog: HTMLDialogElement) {
    const href = dialog.querySelector<HTMLAnchorElement>('a.au-dialog-close[href]')?.href
    if (!href) return
    try {
      const to = new URL(href, location.href)
      if (to.origin !== location.origin || to.href === location.href) return
      history.replaceState(history.state, '', to.pathname + to.search + to.hash)
    } catch {
      // A URL the browser won't take: leave the address as it is.
    }
  }

  get dialog() {
    return this.#dialog
  }

  show(opener?: HTMLElement) {
    const dialog = this.#dialog

    if (!dialog) {
      return
    }
    this.#opener = opener ?? (document.activeElement as HTMLElement | null)
    if (opener && this.hasAttribute('data-reset-on-open')) this.#reset(dialog)
    dialog.classList.remove('is-leaving')
    dialog.close()
    dialog.showModal()
    this.#lock()
    this.#focusIn(dialog)
    this.dispatchEvent(new CustomEvent('au-open', { bubbles: true }))
  }

  /** The element marked data-autofocus, else the first field in the body, else the panel itself. */
  #focusIn(dialog: HTMLDialogElement) {
    const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const body = dialog.querySelector('.au-dialog-body, .au-drawer-body')
    const target = dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? body?.querySelector<HTMLElement>(focusable) ?? dialog.querySelector<HTMLElement>('.au-dialog, .au-drawer')
    target?.focus({ preventScroll: true })
  }

  #unlock: (() => void) | null = null

  /** The page behind doesn't scroll (and doesn't shift when its scrollbar goes). */
  #lock() {
    const body = document.body, sw = window.innerWidth - document.documentElement.clientWidth
    const was = [body.style.overflow, body.style.paddingRight]
    body.style.overflow = 'hidden'
    if (sw > 0) body.style.paddingRight = `${sw}px`
    this.#unlock = () => { body.style.overflow = was[0]; body.style.paddingRight = was[1] }
  }

  hide() {
    const dialog = this.#dialog

    if (!dialog?.open || dialog.classList.contains('is-leaving')) {
      return
    }
    dialog.classList.add('is-leaving')
    // Close once the exit animations have run (each panel sets its own: a drawer's is longer than a dialog's), at most 1s.
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      this.#closed(dialog)
    }
    const timer = window.setTimeout(finish, exitMs() ? 1000 : 0)
    requestAnimationFrame(() => {
      const running = dialog.getAnimations?.({ subtree: true }) ?? []
      if (!running.length) finish()
      else Promise.all(running.map((a) => a.finished)).then(finish, finish)
    })
  }

  #closed(dialog: HTMLDialogElement) {
    dialog.classList.remove('is-leaving')
    dialog.close()
    this.#unlock?.()
    this.#unlock = null
    if (this.#arrived) {
      this.#arrived = false
      this.#restoreAddress(dialog)
    }
    this.#returnFocus()
    this.dispatchEvent(new CustomEvent('au-close', { bubbles: true }))
  }
}
