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

createAll(Button)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(Radios)
createAll(SkipLink)
createAll(Tabs)
initAllowListCounts()
