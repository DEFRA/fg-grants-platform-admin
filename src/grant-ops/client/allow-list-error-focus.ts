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
        const position = startOfLine(input.value, line)
        input.setSelectionRange(position, position)
      })
    })
}
