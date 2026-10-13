const startOfLine = (value: string, line: number): number => {
  if (line === 1) {
    return 0
  }

  const lineEnding = /\r\n|\r|\n/g
  let currentLine = 1
  let match: RegExpExecArray | null

  while ((match = lineEnding.exec(value))) {
    currentLine += 1
    if (currentLine === line) {
      return match.index + match[0].length
    }
  }

  return value.length
}

const rangeOfLine = (value: string, line: number): [number, number] => {
  const start = startOfLine(value, line)
  const nextLineEnding = value.slice(start).search(/\r\n|\r|\n/)
  const end = nextLineEnding === -1 ? value.length : start + nextLineEnding

  return [start, end]
}

const scrollToLine = (input: HTMLTextAreaElement, line: number) => {
  const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight)

  if (Number.isNaN(lineHeight)) {
    return
  }

  const lineTop = (line - 1) * lineHeight
  input.scrollTop = Math.max(0, lineTop - (input.clientHeight - lineHeight) / 2)
}

export const initAllowListErrorFocus = (root: ParentNode = document): void => {
  root
    .querySelectorAll<HTMLAnchorElement>('a[data-error-line][href^="#"]')
    .forEach((link) => {
      link.addEventListener('click', (event) => {
        const line = Number(link.dataset.errorLine)
        const input = link.ownerDocument.getElementById(link.hash.slice(1))

        if (
          !(input instanceof HTMLTextAreaElement) ||
          !Number.isInteger(line)
        ) {
          return
        }

        event.preventDefault()
        input.focus()
        const [start, end] = rangeOfLine(input.value, line)
        input.setSelectionRange(start, end)
        scrollToLine(input, line)
      })
    })
}
