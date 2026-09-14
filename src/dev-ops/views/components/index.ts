import '../../client/focus-on-arrival.ts'
import { AuditSwitch } from './audit-switch/audit-switch.element.ts'
import { LoadMore } from './load-more/load-more.element.ts'
import { StickyTop } from './sticky-top/sticky-top.element.ts'
import { ThemeToggle } from './theme-toggle/theme-toggle.element.ts'

customElements.define('do-audit-switch', AuditSwitch)
customElements.define('do-load-more', LoadMore)
customElements.define('do-sticky-top', StickyTop)
customElements.define('do-theme-toggle', ThemeToggle)
