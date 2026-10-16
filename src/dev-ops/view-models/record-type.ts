/** What tells an application's page from a case's; they are otherwise the same. */
export interface RecordType {
  /** The list a Back link names. */
  listId: string
  itemId: string
  title: string
  /** Where its pages live. */
  path: string
  /** The service a failed read is blamed on. */
  source: string
  showClosed: boolean
  linkLabel: string
}
