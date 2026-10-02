/** What tells the Applications and Cases areas apart; their lists and pages are otherwise the same. */
export interface RecordType {
  /** The list's testid prefix, and the nav area. */
  id: string
  /** A record's testid prefix. */
  item: string
  title: string
  path: string
  noun: { one: string; many: string }
  /** The code filter's name: Grant or Workflow. */
  codeName: string
  /** The service a failed read is blamed on. */
  source: string
  showClosed: boolean
  /** The link to the other record: "View case" or "View application". */
  counterpart: string
  /** GAS's name for the check of the other record, and what to say when it failed. */
  counterpartHop: string
  counterpartUnknown: string
}
