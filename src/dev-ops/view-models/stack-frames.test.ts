import { toStackFrames } from './stack-frames.ts'

describe('toStackFrames', () => {
  const frames =
    '    at handler (/app/src/x.js:1:1)\n    at run (/app/src/y.js:2:2)'

  test('drops a header that repeats the name and message', () => {
    expect(toStackFrames('Error', 'boom', `Error: boom\n${frames}`)).toBe(
      'at handler (/app/src/x.js:1:1)\nat run (/app/src/y.js:2:2)'
    )
  })

  test('drops a header that runs past one line', () => {
    expect(
      toStackFrames(
        'Error',
        'boom\nand again',
        `Error: boom\nand again\n${frames}`
      )
    ).toBe('at handler (/app/src/x.js:1:1)\nat run (/app/src/y.js:2:2)')
  })

  test('keeps a header that says more than the attempt line', () => {
    const stack = `Error: boom and the rest of it\n${frames}`

    expect(toStackFrames('Error', 'boom', stack)).toBe(stack)
  })

  test('keeps a stack that has no frames at all', () => {
    expect(toStackFrames('Error', 'boom', 'Error: boom')).toBe('Error: boom')
  })

  test('keeps a stack that opens with its frames', () => {
    expect(toStackFrames('Error', 'boom', frames)).toBe(frames)
  })

  test('keeps a null stack null, so the page draws no expander', () => {
    expect(toStackFrames('Error', 'boom', null)).toBeNull()
  })

  test('re-indents the frames against their own common indent', () => {
    expect(
      toStackFrames(
        'Error',
        'boom',
        'Error: boom\n        at outer (/x.js:1:1)\n            at inner (/y.js:2:2)'
      )
    ).toBe('at outer (/x.js:1:1)\n    at inner (/y.js:2:2)')
  })

  test('reads a name and message with no space to spare', () => {
    expect(toStackFrames('Error', '', `Error:\n${frames}`)).toBe(
      'at handler (/app/src/x.js:1:1)\nat run (/app/src/y.js:2:2)'
    )
  })
})
