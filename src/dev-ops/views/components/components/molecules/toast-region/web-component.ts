/**
 * Toast region: the region shows in the top layer (a manual popover) and, while a modal
 * dialog is open, moves into the newest one (outside it the modal would make it inert) and is re-shown above it;
 * it comes back when the dialogs close. Without a script it stays where the server drew it.
 */
export class AuToastRegion extends HTMLElement {
  #region: HTMLElement | null = null

  connectedCallback() {
    if (this.#region) return
    this.#region = this.querySelector(':scope > .au-toast-region')
    if (!this.#region) return
    if ('showPopover' in this.#region) this.#region.setAttribute('popover', 'manual')
    document.addEventListener('au-open', this.#follow)
    document.addEventListener('au-close', this.#follow)
    this.#follow()
  }

  disconnectedCallback() {
    document.removeEventListener('au-open', this.#follow)
    document.removeEventListener('au-close', this.#follow)
  }

  #follow = () => {
    const region = this.#region!
    const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal'))
    const host = modals[modals.length - 1] ?? this
    if (region.parentElement !== host) host.append(region)
    try {
      if (region.matches(':popover-open')) region.hidePopover()
      region.showPopover?.()
    } catch {}
  }
}
