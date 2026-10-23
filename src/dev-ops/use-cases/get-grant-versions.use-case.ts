import type { GrantVersions } from '../repositories/grants.repository.ts'
import { findGrantVersions } from '../repositories/grants.repository.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'

export type { GrantVersions } from '../repositories/grants.repository.ts'

export const getGrantVersionsUseCase = async (
  code: string
): Promise<RecordResult<GrantVersions>> =>
  readRecord('grant', () => findGrantVersions(code), 'GRANT_NOT_FOUND')
