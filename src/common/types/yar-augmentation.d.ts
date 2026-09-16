import '@hapi/yar'

import type { RedriveNotice } from '../../dev-ops/view-models/event-page.view-model.ts'

declare module '@hapi/yar' {
  interface YarFlashes {
    claimableItemCreated: string
    redriveOutcome: RedriveNotice
  }
}
