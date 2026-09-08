const storageKey = 'dev-ops-theme'

const readTheme = () => {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

const writeTheme = (theme: string | null) => {
  try {
    if (theme === null) {
      localStorage.removeItem(storageKey)
    } else {
      localStorage.setItem(storageKey, theme)
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The
    // toggle still switches the theme; only persistence is lost.
  }
}

const DARK = 'dark'
const LIGHT = 'light'

/** What the operating system asks for when nothing has been chosen here. */
const prefersDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * The theme this page is actually in, decided rather than inherited: a stored
 * choice if there is one, and the system's preference if there is not.
 */
const currentTheme = (): string => {
  const stored = readTheme()

  if (stored === DARK || stored === LIGHT) {
    return stored
  }

  return prefersDark() ? DARK : LIGHT
}

/**
 * Enhances the theme-toggle component.
 *
 * The checkbox alone switches the theme through daisyUI's CSS, so it works
 * before this element upgrades and with scripting off — but only one way. The
 * generated stylesheet says exactly why: the system-preference rule is
 * `:root:not([data-theme])`, so on a dark-OS machine the page was dark, the
 * toggle sat in its "light" position reporting the opposite of the truth, and
 * checking it for dark changed nothing an operator could see. Unchecking it
 * could never reach light at all, because light was only ever the absence of
 * a preference.
 *
 * So this states the theme rather than nudging it: `data-theme` on the root,
 * always one of the two, which is the selector that outranks the preference
 * rule. The checkbox is then set from what is actually applied, so the control
 * and the page agree — which is the whole job of a control that reports state.
 *
 * KNOWN GAP: a page still paints in the OS theme for the moment before this
 * module runs, so an operator who chose against their OS sees a flash. Killing
 * that needs a script in the head, and the CSP here allows inline script only
 * by sha256 hash (server/plugins/content-security-policy.ts) — a coupling
 * between a template's bytes and a policy string that is worth more than the
 * flash costs.
 */
export class ThemeToggle extends HTMLElement {
  connectedCallback() {
    // A parser can connect an already-defined element before its children
    // exist, so enhancement is deferred a microtask rather than reading
    // children here.
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const checkbox = this.querySelector<HTMLInputElement>(
      'input.theme-controller'
    )

    if (!checkbox) {
      return
    }

    this.#apply(currentTheme(), checkbox)

    checkbox.addEventListener('change', () => {
      const theme = checkbox.checked ? DARK : LIGHT

      writeTheme(theme)
      this.#apply(theme, checkbox)
    })
  }

  /** The root says which theme it is in, and the control agrees with it. */
  #apply(theme: string, checkbox: HTMLInputElement) {
    document.documentElement.dataset.theme = theme
    checkbox.checked = theme === DARK
  }
}
