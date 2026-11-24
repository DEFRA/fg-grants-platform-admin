import type {
  Vocabulary,
  VocabularySource
} from '../use-cases/explore-calls.ts'

type VocabularyPath = VocabularySource['paths'][number]

export interface EditorField {
  name: string
  detail: string
  type?: 'number' | 'date' | 'flag' | 'objectId'
  values?: { value: string; label?: string }[]
}

export interface EditorSource {
  name: string
  detail: string
  fields: EditorField[]
}

/** The sources and paths as the query editor reads them, to suggest and colour what's typed. */
export interface EditorVocabulary {
  sources: EditorSource[]
  anything: false
  open: true
}

export const noVocabulary: EditorVocabulary = {
  sources: [],
  anything: false,
  open: true
}

const typeDetails: Record<NonNullable<VocabularyPath['type']>, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'True or false',
  date: 'Date',
  objectId: 'ObjectId'
}

const toDetail = ({ type, indexed }: VocabularyPath): string => {
  const kind = type ? typeDetails[type] : 'Stored value'

  return indexed ? `${kind}, indexed` : kind
}

const types: Partial<
  Record<NonNullable<VocabularyPath['type']>, EditorField['type']>
> = {
  number: 'number',
  date: 'date',
  boolean: 'flag',
  objectId: 'objectId'
}

const toType = ({ type }: VocabularyPath) => {
  const editorType = type ? types[type] : undefined

  return editorType ? { type: editorType } : {}
}

const toValues = ({ values = [] }: VocabularyPath) =>
  values.length
    ? { values: values.map(({ value, label }) => ({ value, label })) }
    : {}

/** A path as a field the editor names it by, a closed path with its stored values. */
const toField = (path: VocabularyPath): EditorField => ({
  name: path.path,
  detail: toDetail(path),
  ...toType(path),
  ...toValues(path)
})

export const toEditorVocabulary = ({
  sources
}: Vocabulary): EditorVocabulary => ({
  sources: sources.map(({ name, label, paths }) => ({
    name,
    detail: label,
    fields: paths.map(toField)
  })),
  anything: false,
  open: true
})
