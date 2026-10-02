/** Long enough to be read out, short enough that a second copy says so again. */
const announcedForMs = 2000

interface Parts {
  tools: HTMLElement
  button: HTMLButtonElement
  label: HTMLElement
  status: HTMLElement
}

/** The document as `JSON.stringify(value, null, 2)` printed it, folded parts and all. */
export const toCopyText = (viewer: Element): string =>
  [...viewer.querySelectorAll('[data-json-line]')]
    .map((line) => line.textContent)
    .join('\n')

/**
 * The viewer folds and reads with no script; this adds the one thing that
 * needs it, Copy, and shows the button only once it can work.
 */
export class JsonViewer extends HTMLElement {
  #enhanced = false
  #timer: number | undefined
  #copyLabel = ''

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts(): Parts | null {
    const parts = {
      tools: this.querySelector('[data-json-viewer-tools]'),
      button: this.querySelector('[data-json-viewer-copy]'),
      label: this.querySelector('[data-json-viewer-copy-label]'),
      status: this.querySelector('[data-json-viewer-status]')
    }

    return Object.values(parts).every(Boolean)
      ? (parts as unknown as Parts)
      : null
  }

  enhance() {
    const parts = this.#parts()

    if (this.#enhanced || !parts || !navigator.clipboard) {
      return
    }

    this.#enhanced = true
    this.#copyLabel = String(parts.label.textContent)
    parts.button.addEventListener('click', () => this.#copy(parts))
    parts.tools.hidden = false
  }

  async #copy(parts: Parts) {
    try {
      await navigator.clipboard.writeText(toCopyText(this))
      this.#say(parts, 'Copied')
    } catch {
      this.#say(parts, "Couldn't copy")
    }
  }

  /**
   * In the live region for a screen reader, cleared once said; on the button
   * for the eye until the operator moves on from it, so it is still there to
   * read however long the copy took.
   */
  #say(parts: Parts, message: string) {
    parts.label.textContent = message
    parts.status.textContent = message
    window.clearTimeout(this.#timer)
    this.#timer = window.setTimeout(() => {
      parts.status.textContent = ''
    }, announcedForMs)
    parts.button.addEventListener(
      'blur',
      () => {
        parts.label.textContent = this.#copyLabel
      },
      { once: true }
    )
  }
}
