import { ThemeToggle } from './theme-toggle/theme-toggle.element.ts'

/**
 * The dev-ops app's client entry, loaded as a module by the layout. Custom
 * elements are defined here rather than in their own modules as a top-level
 * side effect there could be tree-shaken away under `"sideEffects": false`;
 * an entry's own statements always run. A component that ships no behaviour
 * simply has no element to define.
 */
customElements.define('do-theme-toggle', ThemeToggle)
