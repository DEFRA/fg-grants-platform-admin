import { CopyButton } from './copy-button/copy-button.element.ts'
import { ThemeToggle } from './theme-toggle/theme-toggle.element.ts'

/**
 * The dev-ops app's client entry, loaded as a module by the layout. Custom
 * elements are defined here rather than in their own modules as a top-level
 * side effect there could be tree-shaken away under `"sideEffects": false`;
 * an entry's own statements always run. A component that ships no behaviour
 * simply has no element to define.
 *
 * There were three. The time-range dropdown's whole job was dismissal — a
 * click elsewhere, an Escape — and its panel is a popover now, so the browser
 * does both and the element has been deleted rather than kept as a wrapper
 * around nothing.
 */
customElements.define('do-copy-button', CopyButton)
customElements.define('do-theme-toggle', ThemeToggle)
