import { readFileSync } from 'node:fs'

import { qeCheck, qeTokenize } from '../views/components/core/query.ts'
import type {
  QueryProblem,
  QueryVocabulary
} from '../views/components/core/query.ts'

/**
 * GAS's corpus, copied as GAS generates it: each query with how GAS cuts it
 * into tokens and what GAS answers. The editor warns as people type and GAS
 * has the last word on Run, so wherever GAS runs a query the editor must stay
 * quiet, and wherever GAS refuses one for its shape the editor must say the
 * same thing at the same place. A fresh copy of the components or of this
 * file runs the test again.
 */
interface Entry {
  text: string
  tokens: { k: string; at: number; end: number }[]
  outcome: 'ok' | QueryProblem
  shape?: boolean
  editorDiffers?: string
}

const corpus = JSON.parse(
  readFileSync(new URL('./explore-corpus.json', import.meta.url), 'utf8')
) as { vocabulary: QueryVocabulary; entries: Entry[] }

const spansOf = (tokens: { k: string; at: number; end: number }[]) =>
  tokens.map(({ k, at, end }) => ({ k, at, end }))

const runs = corpus.entries.filter(
  ({ outcome, editorDiffers }) => outcome === 'ok' && !editorDiffers
)
const shapes = corpus.entries.filter(
  ({ shape, editorDiffers }) => shape && !editorDiffers
)
const differs = corpus.entries.filter(
  ({ outcome, editorDiffers }) => editorDiffers && outcome !== 'ok'
)
const warnsOnRuns = corpus.entries.filter(
  ({ outcome, editorDiffers }) => editorDiffers && outcome === 'ok'
)

describe('the editor against GAS’s corpus', () => {
  test('has queries of every kind to check', () => {
    expect([runs, shapes, differs].map((list) => list.length > 0)).toEqual([
      true,
      true,
      true
    ])
  })

  test.each(corpus.entries.map((entry) => [entry.text, entry]))(
    'cuts %j into the tokens GAS does',
    (_, { text, tokens }) => {
      expect(spansOf(qeTokenize(text))).toEqual(spansOf(tokens))
    }
  )

  test.each(runs.map((entry) => [entry.text]))(
    'is quiet on %j, which GAS runs',
    (text) => {
      expect(qeCheck(text, corpus.vocabulary)).toBeNull()
    }
  )

  test.each(shapes.map((entry) => [entry.text, entry.outcome]))(
    'says what GAS says, where it says it, of %j',
    (text, outcome) => {
      expect(qeCheck(text, corpus.vocabulary)).toEqual(outcome)
    }
  )

  test.each(differs.map((entry) => [entry.text, entry]))(
    'still differs from GAS on %j: take it off the list once the components agree',
    (text, { outcome }) => {
      expect(qeCheck(text, corpus.vocabulary)).not.toEqual(outcome)
    }
  )

  test.each(warnsOnRuns.map((entry) => [entry.text]))(
    'still warns on %j, which GAS runs: take it off the list once the components agree',
    (text) => {
      expect(qeCheck(text, corpus.vocabulary)).not.toBeNull()
    }
  )
})
