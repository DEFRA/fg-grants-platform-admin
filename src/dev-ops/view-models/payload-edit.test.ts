import { scanJson } from '../use-cases/json-scan.ts'
import { toFaultMessage, toPayloadEditor } from './payload-edit.ts'

describe('toFaultMessage', () => {
  test('names the place and what should have been there', () => {
    expect(toFaultMessage({ line: 17, column: 9, expected: 'a colon' })).toBe(
      'Expected a colon at line 17, column 9.'
    )
  })

  test('never quotes the text it is about', () => {
    const secret = 'SBI-106284736'
    const text = `{ "sbi": "${secret}" "name": "Jane Doe" }`
    const { fault } = scanJson(text)

    expect(fault).not.toBeNull()
    expect(toFaultMessage(fault!)).toBe(
      'Expected a comma or a closing brace at line 1, column 26.'
    )
    expect(toFaultMessage(fault!)).not.toContain(secret)
  })
})

describe('toPayloadEditor', () => {
  const stale = (text: string) =>
    ({ step: 'edit', text, revision: 3, problem: { kind: 'stale' } }) as const

  test('shows the payload as it is now beside a stale edit', () => {
    const editor = toPayloadEditor(stale('{"a": 2}'), '{\n  "a": 1\n}')

    expect(editor.currentView?.rows).toContainEqual({
      kind: 'line',
      number: 2,
      text: '  "a": 1'
    })
  })

  test('shows nothing beside a stale edit of an event with no payload', () => {
    expect(toPayloadEditor(stale('{"a": 2}'), '').currentView).toBeNull()
  })
})
