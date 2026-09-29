import {
  checkEditPayload,
  editNoteMaxLength,
  payloadMaxBytes,
  readPayload,
  toEditNote,
  toEditNoteProblem,
  toEditText
} from './edit-payload-command.ts'

/** A payload whose formatted form is `bytes` long. */
const payloadOf = (bytes: number): string => {
  const shell = JSON.stringify({ a: '' }, null, 2).length

  return JSON.stringify({ a: 'x'.repeat(bytes - shell) }, null, 2)
}

describe('toEditNote', () => {
  test('folds a browser CRLF to one character, then trims', () => {
    expect(toEditNote('  one\r\ntwo \r\n')).toBe('one\ntwo')
  })
})

describe('toEditNoteProblem', () => {
  test('asks for a note when none was given', () => {
    expect(toEditNoteProblem('')).toBe('missing')
  })

  test('reads a note of spaces as none, once trimmed', () => {
    expect(toEditNoteProblem(toEditNote(' \r\n\t '))).toBe('missing')
  })

  test('takes a note of exactly the limit', () => {
    expect(toEditNoteProblem('a'.repeat(editNoteMaxLength))).toBeNull()
  })

  test('asks for a shorter note one character over', () => {
    expect(toEditNoteProblem('a'.repeat(editNoteMaxLength + 1))).toBe(
      'too-long'
    )
  })

  test('counts each line break once, as the counter on the page does', () => {
    const note = toEditNote(`${'a'.repeat(249)}\r\n${'b'.repeat(250)}`)

    expect(note).toHaveLength(editNoteMaxLength)
    expect(toEditNoteProblem(note)).toBeNull()
  })
})

describe('toEditText', () => {
  test('folds every CRLF a browser sent back to a line feed', () => {
    expect(toEditText('{\r\n  "a": 1\r\n}')).toBe('{\n  "a": 1\n}')
  })
})

describe('readPayload', () => {
  test('reads an object and formats it at two spaces', () => {
    expect(readPayload('{"a":1,  "b":[true]}')).toEqual({
      kind: 'read',
      value: { a: 1, b: [true] },
      formatted: '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}'
    })
  })

  test('says where a broken text broke', () => {
    expect(readPayload('{\n  "a": 1,\n}')).toEqual({
      kind: 'refused',
      problem: {
        kind: 'unreadable',
        fault: {
          line: 3,
          column: 1,
          expected: 'a property name in double quotes'
        }
      }
    })
  })

  test('refuses a __proto__ key, which the backends would turn away with a bare 400', () => {
    expect(readPayload('{"data": {"__proto__": {"admin": true}}}')).toEqual({
      kind: 'refused',
      problem: { kind: 'prototype-key' }
    })
  })

  test('refuses one spelt with escapes as well', () => {
    expect(readPayload(String.raw`{"__proto__": {}}`)).toEqual({
      kind: 'refused',
      problem: { kind: 'prototype-key' }
    })
  })

  test('refuses a key starting with $ where it stands, as the backends would', () => {
    expect(readPayload('{\n  "data": {\n    "$set": 1\n  }\n}')).toEqual({
      kind: 'refused',
      problem: { kind: 'dollar-key', at: { line: 3, column: 5 } }
    })
  })

  test('refuses a repeated key rather than keeping only its last value', () => {
    expect(readPayload('{\n  "sbi": 1,\n  "sbi": 2\n}')).toEqual({
      kind: 'refused',
      problem: { kind: 'duplicate-key', at: { line: 3, column: 3 } }
    })
  })

  test('reads a constructor key as the ordinary key it is', () => {
    expect(readPayload('{"constructor": {"prototype": 1}}').kind).toBe('read')
  })

  test.each([
    ['an array', '[1]'],
    ['a string', '"a"'],
    ['null', 'null']
  ])('refuses %s, which is not an object', (_name, text) => {
    expect(readPayload(text)).toEqual({
      kind: 'refused',
      problem: { kind: 'not-an-object' }
    })
  })

  test('takes a payload of exactly 256 KiB once formatted', () => {
    expect(readPayload(payloadOf(payloadMaxBytes)).kind).toBe('read')
  })

  test('refuses one byte over', () => {
    expect(readPayload(payloadOf(payloadMaxBytes + 1))).toEqual({
      kind: 'refused',
      problem: { kind: 'too-large' }
    })
  })

  test('measures the bound in bytes, not characters', () => {
    const euro = JSON.stringify({ a: '€'.repeat(payloadMaxBytes / 3) }, null, 2)

    expect(euro.length).toBeLessThan(payloadMaxBytes)
    expect(readPayload(euro)).toEqual({
      kind: 'refused',
      problem: { kind: 'too-large' }
    })
  })

  test('measures the bound on the formatted payload, not the text as typed', () => {
    const compact = JSON.stringify({ a: 'x'.repeat(payloadMaxBytes - 12) })

    expect(compact.length).toBeLessThan(payloadMaxBytes)
    expect(readPayload(compact).kind).toBe('refused')
  })

  test('refuses a text far past the bound without reading it', () => {
    expect(readPayload(`{${' '.repeat(payloadMaxBytes * 4)}}`)).toEqual({
      kind: 'refused',
      problem: { kind: 'too-large' }
    })
  })
})

describe('checkEditPayload', () => {
  const text = '{\r\n  "a": 1\r\n}'

  test('reads the text and trims the note into the edit it sends', () => {
    expect(
      checkEditPayload({ text, revision: 3, note: ' why\r\nnow ' })
    ).toEqual({
      kind: 'valid',
      edit: { payload: { a: 1 }, note: 'why\nnow', revision: 3 }
    })
  })

  test('sends back a missing note, trimmed', () => {
    expect(checkEditPayload({ text, revision: 3, note: ' \r\n ' })).toEqual({
      kind: 'invalid',
      note: '',
      noteProblem: 'missing'
    })
  })

  test('sends back a text that no longer reads, keeping the note', () => {
    expect(
      checkEditPayload({ text: '{"a": 1,}', revision: 3, note: ' why ' })
    ).toEqual({ kind: 'invalid', note: 'why', noteProblem: null })
  })
})
