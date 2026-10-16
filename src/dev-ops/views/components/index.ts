import '../../client/focus-on-arrival.ts'
import { Back } from './back/back.element.ts'
import { CharCount } from './char-count/char-count.element.ts'
import { ChoiceMenu } from './filter-menu/choice-menu.element.ts'
import { FilterSwitch } from './filter-switch/filter-switch.element.ts'
import { JsonViewer } from './json-viewer/json-viewer.element.ts'
import { LoadMore } from './load-more/load-more.element.ts'
import { PayloadEditor } from './payload-editor/payload-editor.element.ts'
import { StickyTop } from './sticky-top/sticky-top.element.ts'
import { ThemeToggle } from './theme-toggle/theme-toggle.element.ts'

customElements.define('do-back', Back)
customElements.define('do-char-count', CharCount)
customElements.define('do-choice-menu', ChoiceMenu)
customElements.define('do-filter-switch', FilterSwitch)
customElements.define('do-json-viewer', JsonViewer)
customElements.define('do-load-more', LoadMore)
customElements.define('do-payload-editor', PayloadEditor)
customElements.define('do-sticky-top', StickyTop)
customElements.define('do-theme-toggle', ThemeToggle)
