import { getFromGas, putToGas } from '../../common/gas.ts'
import {
  getGrantAllowList,
  replaceGrantAllowList
} from './allow-list.repository.ts'

vi.mock(import('../../common/gas.ts'))

const view = {
  sbi: {
    key: 'sbi',
    label: 'Single Business Identifiers (SBIs)',
    value: '900000002',
    hint: 'One per line. 1 listed.'
  },
  crn: {
    key: 'crn',
    label: 'Customer Reference Numbers (CRNs)',
    value: '9000000001',
    hint: 'One per line. 1 listed.'
  },
  errorSummary: []
}

describe('getGrantAllowList', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(view)
  })

  test('returns the allow-list view from GAS', async () => {
    await expect(getGrantAllowList('woodland')).resolves.toEqual(view)
  })

  test('calls the allow-list endpoint', async () => {
    await getGrantAllowList('woodland')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list'
    )
  })

  test('escapes the grant code as one path segment', async () => {
    await getGrantAllowList('woodland/../admin')

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/allow-list'
    )
  })
})

describe('replaceGrantAllowList', () => {
  const form = { sbi: '900000002', crn: '9000000001' }

  beforeEach(() => {
    vi.mocked(putToGas).mockResolvedValue(view)
  })

  test('returns the view GAS built from the saved allow list', async () => {
    await expect(replaceGrantAllowList('woodland', form)).resolves.toEqual(view)
  })

  test('sends the submitted text as-is, unparsed', async () => {
    await replaceGrantAllowList('woodland', form)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list',
      { payload: form }
    )
  })

  test('escapes the grant code as one path segment', async () => {
    await replaceGrantAllowList('woodland/../admin', form)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland%2F..%2Fadmin/allow-list',
      expect.anything()
    )
  })

  test('sends empty fields rather than omitting them', async () => {
    const empty = { sbi: '', crn: '' }

    await replaceGrantAllowList('woodland', empty)

    expect(putToGas).toHaveBeenCalledWith(
      '/grant-admin/grants/woodland/allow-list',
      { payload: empty }
    )
  })
})
