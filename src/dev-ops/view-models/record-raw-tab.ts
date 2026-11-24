import { logger } from '../../common/logger.ts'
import type { RecordSectionError } from '../use-cases/record-reads.ts'
import { kindOf, readBase64, toEjson, toPrinted } from './explore-bson.ts'
import type { BsonValue } from './explore-bson.ts'
import { toSectionError, tooLarge } from './record-events-tab.ts'
import type { Message, TabNotice } from './record-events-tab.ts'

export type RawTab =
  | TabNotice
  | { kind: 'document'; doc: BsonValue; ejson: string }
  | { kind: 'too-large'; text: string }

export interface RawCopy {
  /** What the stored document is, as its sentences name it. */
  noun: string
  error: Message
}

const kib = 1024
const mib = kib * kib

const sizeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

/** "2.4 MiB", or "512 KiB" below a mebibyte. */
export const toSize = (bytes: number): string =>
  bytes >= mib
    ? `${sizeFormat.format(bytes / mib)} MiB`
    : `${sizeFormat.format(bytes / kib)} KiB`

const isTooLarge = (sectionErrors: RecordSectionError[]) =>
  sectionErrors.some(
    ({ section, message }) => section === 'raw' && message === tooLarge
  )

/** GAS's Raw cap: a document within it was refused for holding more than 250,000 values. */
const rawCapBytes = mib

const tooLargeText = (noun: string, bytes: number | null | undefined) => {
  if (typeof bytes !== 'number') {
    return `The stored ${noun} is too large to show on this page.`
  }

  return bytes > rawCapBytes
    ? `The stored ${noun} is ${toSize(bytes)}, too large for this page.`
    : `The stored ${noun} is ${toSize(bytes)}, with too many values to print on a page.`
}

/** The document GAS sent, printed and as canonical Extended JSON; bytes that aren't BSON are the tab's error, logged by kind alone. */
const toDocumentTab = (base64: string, noun: string, error: RawTab): RawTab => {
  try {
    const stored = readBase64(base64)

    return { kind: 'document', doc: toPrinted(stored), ejson: toEjson(stored) }
  } catch (failure) {
    logger.warn(`The stored ${noun} isn’t readable as BSON: ${kindOf(failure)}`)

    return error
  }
}

/** A document is null only beside a Raw section error, so one missing without it is the tab's error too. */
export const toRawTab = (
  {
    document,
    storedBytes,
    sectionErrors
  }: {
    document?: string | null
    storedBytes?: number | null
    sectionErrors: RecordSectionError[]
  },
  copy: RawCopy,
  tabHref: string
): RawTab => {
  if (isTooLarge(sectionErrors)) {
    return { kind: 'too-large', text: tooLargeText(copy.noun, storedBytes) }
  }

  const error: RawTab = {
    kind: 'error',
    error: { ...copy.error, retryHref: tabHref }
  }

  if (toSectionError(sectionErrors, 'raw')) {
    return error
  }

  if (typeof document !== 'string') {
    logger.warn(
      `The stored ${copy.noun} is missing from the answer: no document`
    )

    return error
  }

  return toDocumentTab(document, copy.noun, error)
}
