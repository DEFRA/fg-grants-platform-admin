import { LineTooLongError, readLines } from './lines.ts'

const chunks = async function* (...parts: (string | Buffer)[]) {
  yield* parts
}

const all = async (lines: AsyncIterable<string>): Promise<string[]> => {
  const read: string[] = []

  for await (const line of lines) {
    read.push(line)
  }

  return read
}

describe('readLines', () => {
  test('reads lines split across chunks, and chunks holding several', async () => {
    expect(
      await all(readLines(chunks('{"a"', ':1}\n{"b":2}\n{', '"c":3}\n'), 100))
    ).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  test('keeps a character whose bytes a chunk splits', async () => {
    const bytes = Buffer.from('"🌳"\n')

    expect(
      await all(readLines(chunks(bytes.subarray(0, 3), bytes.subarray(3)), 100))
    ).toEqual(['"🌳"'])
  })

  test('drops text after the last line break, as no whole line', async () => {
    expect(await all(readLines(chunks('a\nb'), 100))).toEqual(['a'])
  })

  test('refuses a line longer than the most it holds', async () => {
    await expect(
      all(readLines(chunks('x'.repeat(5), 'x'.repeat(5), '\n'), 8))
    ).rejects.toThrow(LineTooLongError)
  })
})
