import '@hapi/yar'

import type {
  StoredSearch,
  StoredSearchKey
} from '../../dev-ops/view-models/stored-search.ts'
import type { DefinitionFetchFlash } from '../../dev-ops/view-models/definition-fetch.ts'
import type {
  EventNotice,
  PurgeFormNotice
} from '../../dev-ops/view-models/event-page.view-model.ts'

declare module '@hapi/yar' {
  interface YarFlashes {
    claimableItemCreated: string
    claimableItemUpdated: string
    claimableItemRefused: { text: string }
    allowListSaved: string
    allowListActiveTab: 'who-can-apply'
    /** Both event writes: `action` says which one this was. */
    redriveOutcome: EventNotice
    purgeForm: PurgeFormNotice
    definitionFetchOutcome: DefinitionFetchFlash
  }

  interface YarValues {
    [key: StoredSearchKey]: StoredSearch
  }
}
