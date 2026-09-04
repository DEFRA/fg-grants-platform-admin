/**
 * Closes the `<details>` dropdown it wraps when the operator clicks away from
 * it or presses Escape.
 *
 * Everything else about the control is the browser's: `<summary>` is already a
 * focusable button that toggles on Enter, Space and a click, and announces its
 * expanded state. This element adds the one behaviour a disclosure does not
 * have and a menu is expected to — dismissal — and adds nothing else. With
 * scripting off the panel still opens, still takes a keyboard, and still
 * closes on the summary or on following any link inside it, which is every
 * path an operator actually takes out of it.
 *
 * Listeners are on the document because the events worth acting on are the
 * ones that happen outside this element, and they are removed on disconnect so
 * a panel that leaves the page leaves nothing behind.
 */
export class Dropdown extends HTMLElement {
  #onDocumentPointerDown = (event: Event) => {
    if (!this.contains(event.target as Node)) {
      this.close()
    }
  }

  #onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.close()
    }
  }

  connectedCallback() {
    document.addEventListener('pointerdown', this.#onDocumentPointerDown)
    document.addEventListener('keydown', this.#onDocumentKeyDown)
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown)
    document.removeEventListener('keydown', this.#onDocumentKeyDown)
  }

  /**
   * Focus follows the panel back to the button it came out of, but only when
   * it was inside: closing a panel the operator had already left must not
   * yank the caret out of whatever they moved on to.
   */
  #restoreFocus(details: HTMLDetailsElement) {
    if (details.contains(document.activeElement)) {
      details.querySelector('summary')?.focus()
    }
  }

  close() {
    const details = this.querySelector('details')

    if (!details?.open) {
      return
    }

    this.#restoreFocus(details)
    details.open = false
  }
}
