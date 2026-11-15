import { findOthersItems } from '../use-cases/explore-queries.ts'
import { explorePath } from './bucket-nav.ts'

const recentLabelMax = 40

/** A recent query on one line, cut short. */
export const toRecentLabel = (q: string): string => {
  const line = q.replace(/\s+/g, ' ').trim()

  return line.length > recentLabelMax
    ? `${line.slice(0, recentLabelMax).trimEnd()}…`
    : line
}

/** The form a record's Find others items send, naming the record by its page. */
export interface FindOthersForm {
  id: string
  action: string
  hidden: { name: string; value: string }[]
  items: { text: string; value: string }[]
}

export const toFindOthers = (recordHref: string): FindOthersForm => ({
  id: 'find-others',
  action: explorePath,
  hidden: [{ name: 'record', value: recordHref }],
  items: findOthersItems.map(({ value, label }) => ({ text: label, value }))
})
