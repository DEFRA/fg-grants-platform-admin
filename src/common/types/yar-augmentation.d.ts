/**
 * The flash messages this app carries across a redirect. yar keys its flash api
 * off this interface, which is empty until a module augments it.
 */
import '@hapi/yar'

declare module '@hapi/yar' {
  interface YarFlashes {
    claimableItemCreated: string
  }
}
