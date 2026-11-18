import { getFromGas } from '../../common/gas.ts'
import type { Catalogue } from './buckets.repository.ts'

/** What every page GAS answers for is drawn around: the lists in its sidebar. */
export interface Shell {
  catalogue: Catalogue
}

/** For a page that has nothing else to ask GAS. */
export const findShell = async (): Promise<Shell> =>
  (await getFromGas<{ shell: Shell }>('/grant-admin/shell')).shell
