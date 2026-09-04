import { CopyButton } from './copy-button/copy-button.element.ts'
import { Dropdown } from './dropdown/dropdown.element.ts'
import { ThemeToggle } from './theme-toggle/theme-toggle.element.ts'

/**
 * The dev-ops app's client entry, loaded as a module by the layout. Custom
 * elements are defined here rather than in their own modules as a top-level
 * side effect there could be tree-shaken away under `"sideEffects": false`;
 * an entry's own statements always run. A component that ships no behaviour
 * simply has no element to define.
 */
customElements.define('do-copy-button', CopyButton)
customElements.define('do-dropdown', Dropdown)
customElements.define('do-theme-toggle', ThemeToggle)
