/**
 * CopyButton: the server draws the button (CSS hides it where scripts can't run); this copies `data-value` and says
 * "Copied" for 1.6 seconds.
 */
const saidBefore = new WeakMap<Element, string>()

/** Says the words in place of what the part said, or, for null, what it said before. */
const before = (part: Element, read: (part: Element) => string | null) =>
  saidBefore.get(part) ?? read(part)

const sayIn = (
  part: Element | null,
  words: string | null,
  read: (part: Element) => string | null,
  write: (part: Element, words: string) => void
) => {
  if (!part) {
    return
  }

  const was = before(part, read)

  if (was) {
    saidBefore.set(part, was)
    write(part, words ?? was)
  }
}

/** What the button says, by its label and its visible word. */
const say = (button: HTMLButtonElement, words: string | null) => {
  sayIn(
    button,
    words,
    (part) => part.getAttribute('aria-label'),
    (part, said) => part.setAttribute('aria-label', said)
  )
  sayIn(
    button.querySelector('span:not(.au-vh)'),
    words,
    (part) => part.textContent,
    (part, said) => (part.textContent = said)
  )
}

export class AuCopy extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const button = this.querySelector<HTMLButtonElement>('[data-au-copy]')

    if (!button) {
      return
    }
    button.addEventListener('click', () => this.#copy(button))
  }

  async #copy(button: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(this.dataset.value ?? '')
    } catch {
      return
    }
    say(button, 'Copied')
    button.classList.add('is-done')
    window.setTimeout(() => {
      say(button, null)
      button.classList.remove('is-done')
    }, 1600)
  }
}
