import '@hapi/yar'

import type {
  EventNotice,
  PurgeFormNotice
} from '../../dev-ops/view-models/event-page.view-model.ts'

declare module '@hapi/yar' {
  interface YarFlashes {
    claimableItemCreated: string
    /** Both event writes: `action` says which one this was. */
    redriveOutcome: EventNotice
    purgeForm: PurgeFormNotice
  }
}
