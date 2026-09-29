import { scanJson } from '../use-cases/json-scan.ts'
import { toFaultMessage } from './payload-edit.ts'

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
