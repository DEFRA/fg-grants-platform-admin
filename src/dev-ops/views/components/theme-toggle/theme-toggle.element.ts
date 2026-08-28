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

/**
 * Enhances the theme-toggle component: the .theme-controller checkbox it wraps
 * switches the theme through daisyUI's CSS alone, so the toggle works before
 * this element upgrades — or with scripting off. Upgrading adds the one thing
 * CSS cannot do: carrying the choice across page loads.
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

    checkbox.checked = readTheme() === checkbox.value

    checkbox.addEventListener('change', () => {
      writeTheme(checkbox.checked ? checkbox.value : null)
    })
  }
}
