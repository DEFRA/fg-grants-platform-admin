/**
 * Confirm dialog: with `requireText`, Confirm stays off until that text is typed. The body
 * is the dialog's form, so Enter in the field confirms once the text matches (the browser won't submit through an
 * off Confirm). Without the script Confirm is on and the server checks the typed text.
 */
export class AuConfirm extends HTMLElement {
  connectedCallback() {
    const field = this.querySelector<HTMLInputElement>('input[data-au-require]')
    const ok = this.querySelector<HTMLButtonElement>('[data-au-confirm]')
    if (!field || !ok || field.dataset.auUp != null) return
    field.dataset.auUp = ''
    const want = field.dataset.auRequire
    const sync = () => (ok.disabled = field.value !== want)
    field.addEventListener('input', sync)
    ok.form?.addEventListener('submit', (e) => {
      if (field.value !== want) e.preventDefault()
    })
    sync()
  }
}
