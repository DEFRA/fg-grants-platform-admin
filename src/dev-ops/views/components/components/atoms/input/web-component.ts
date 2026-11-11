/**
 * Clearable input: the server draws the Clear button inside the input (hidden while it is empty); this shows it
 * only while the input has a value, and a press empties the input, fires `input` and
 * `change` on it, and puts focus back in it. Without a script the button stays hidden.
 */
export class AuClearable extends HTMLElement {
  #input: HTMLInputElement | null = null
  #button: HTMLButtonElement | null = null

  connectedCallback() {
    if (this.#input) return
    this.#input = this.querySelector('input')
    this.#button = this.querySelector('.au-input-clear')
    if (!this.#input || !this.#button) return
    this.#input.addEventListener('input', this.#sync)
    this.#button.addEventListener('click', () => {
      const input = this.#input!
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      this.dispatchEvent(new CustomEvent('au-clear', { bubbles: true }))
      input.focus()
    })
    this.#input.form?.addEventListener('reset', () => queueMicrotask(this.#sync))
    this.#sync()
  }

  #sync = () => {
    const input = this.#input!
    this.#button!.hidden = !input.value || input.disabled || input.readOnly
  }
}
