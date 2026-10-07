/** What tells the Applications and Cases areas apart; their lists and pages are otherwise the same. */
export interface RecordType {
  /** Also names the nav area. */
  listId: string
  itemId: string
  title: string
  path: string
  noun: { one: string; many: string }
  /** Grant or Workflow. */
  codeName: string
  /** The service a failed read is blamed on. */
  source: string
  showClosed: boolean
  linkLabel: string
}
