// Shapes GAS uses alike for a grant version and a workflow version.

export interface VersionRef {
  code: string
  version: string
}

export type FetchStatus =
  | 'pending'
  | 'fetched'
  | 'transient_error'
  | 'permanent_error'

/** Whether the service holds the file, and its own fetch status for it. */
export interface DefinitionFile {
  stored: boolean
  fetchStatus: FetchStatus
}

export interface VersionSummary {
  version: string
  status: 'active' | 'draft'
  receivedAt: string
}

export type DefinitionFetchReason =
  | 'missing'
  | 'forbidden'
  | 'timeout'
  | 'unparseable'
  | 'invalid'

/** What the service did with one file it had not stored when the fetch began. */
export type DefinitionFetchFile<F extends string = string> =
  | { file: F; outcome: 'stored' }
  | {
      file: F
      outcome: 'failed'
      reason: DefinitionFetchReason
      /** The service's own words, only for an `invalid` file. */
      message: string | null
    }

export interface DefinitionFetch<F extends string = string> {
  /** In the order they were tried; empty when every file was already stored. */
  files: DefinitionFetchFile<F>[]
}

export interface ConfigVersions {
  code: string
  /** The newest active version; null when there is none. */
  current: string | null
  versions: VersionSummary[]
}
