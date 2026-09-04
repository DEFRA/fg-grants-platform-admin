/**
 * How long the check stands in for the clipboard. Long enough to be seen
 * without watching for it, short enough that the row is back to normal before
 * the operator has finished pasting.
 */
const copiedMs = 1500

/**
 * Enhances the copy-button component: writes the element's `value` to the
 * clipboard and shows a check for a moment.
 *
 * The button ships disabled, so this element is what makes it a control at
 * all — and it only does so where there is a clipboard to write to. A page
 * with scripting off, or a browser that refuses the API, keeps a visibly inert
 * button rather than one that swallows every click in silence.
 */
export class CopyButton extends HTMLElement {
  #timer: ReturnType<typeof setTimeout> | undefined

  connectedCallback() {
    // A parser can connect an already-defined element before its children
    // exist, so enhancement is deferred a microtask rather than reading
    // children here.
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    clearTimeout(this.#timer)
  }

  enhance() {
    const button = this.querySelector('button')

    if (!button || !navigator.clipboard) {
      return
    }

    button.disabled = false
    button.addEventListener('click', () => {
      this.copy()
    })
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.getAttribute('value') ?? '')
    } catch {
      // Nothing useful to say: the clipboard can be refused outright (an
      // insecure origin, a denied permission) and a row is no place for an
      // error message about a convenience.
      return
    }

    this.dataset.copied = ''
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      delete this.dataset.copied
    }, copiedMs)
  }
}
