import {
  createAll,
  Button,
  Checkboxes,
  ErrorSummary,
  Radios,
  SkipLink,
  Tabs
} from 'govuk-frontend'
import { initAllowListCounts } from '../../grant-ops/client/allow-list-count.ts'
import { initAllowListCursorLines } from '../../grant-ops/client/allow-list-cursor-line.ts'
import { selectDefaultAllowListTab } from '../../grant-ops/client/allow-list-tabs.ts'

createAll(Button)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(Radios)
createAll(SkipLink)
selectDefaultAllowListTab()
createAll(Tabs)
initAllowListCounts()
initAllowListCursorLines()
