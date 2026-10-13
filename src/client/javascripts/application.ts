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
import { initAllowListErrorFocus } from '../../grant-ops/client/allow-list-error-focus.ts'
import { selectDefaultAllowListTab } from '../../grant-ops/client/allow-list-tabs.ts'

createAll(Button)
createAll(Checkboxes)
createAll(Radios)
createAll(SkipLink)
selectDefaultAllowListTab()
createAll(Tabs)
selectDefaultAllowListTab()
createAll(ErrorSummary)
initAllowListCounts()
initAllowListErrorFocus()
