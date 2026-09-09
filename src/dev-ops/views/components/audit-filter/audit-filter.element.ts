/**
 * Enhances the audit-filter component: a checkbox that applies itself.
 *
 * The control is a real GET form, so it works before this element upgrades and
 * with scripting off — the operator ticks the box and presses Apply. What the
 * element adds is the one thing the form cannot do for itself: sending on the
 * flip, which is what a filter reads as. It clicks the form's own Apply button
 * rather than submitting the form directly, because that button carries the
 * `audit` value the submission needs, and a submission that left it behind
 * would ask for the page the operator is already on.
 *
 * The button is then hidden, not removed: it is still the submitter, and
 * hiding it here rather than in the template means a page whose script never
 * arrives keeps the control that works without one.
 */
export class AuditFilter extends HTMLElement {
  connectedCallback() {
    // A parser can connect an already-defined element before its children
    // exist, so enhancement is deferred a microtask rather than reading
    // children here.
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const checkbox = this.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )
    const apply = this.querySelector<HTMLButtonElement>('button[type="submit"]')

    if (!checkbox || !apply) {
      return
    }

    apply.hidden = true
    checkbox.addEventListener('change', () => {
      apply.click()
    })

    // The button carries the value for the state the page ARRIVED in, and the
    // back button can restore a page whose checkbox no longer matches it.
    //
    // A page restored from the bfcache comes back with its DOM as the operator
    // left it — including a checkbox they unticked on the way out — while the
    // button still says what it said when the server rendered it. Ticking the
    // box then submitted the value for unticking it: the control did the exact
    // opposite of what it showed, from an ordinary Back.
    //
    // So a restored page is put back to the state it was rendered in, which is
    // the state the button is still talking about.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        checkbox.checked = checkbox.defaultChecked
      }
    })
  }
}
