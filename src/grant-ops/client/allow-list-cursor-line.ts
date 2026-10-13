const cursorLine = (input: HTMLTextAreaElement): number =>
  input.value.slice(0, input.selectionStart).split(/\r\n|\r|\n/).length

const initialiseCursorLine = (input: HTMLTextAreaElement) => {
  const lineNumber = document.createElement('div')
  lineNumber.className = 'govuk-hint app-allow-list-line-number'
  lineNumber.hidden = true
  input.insertAdjacentElement('afterend', lineNumber)

  const update = () => {
    lineNumber.textContent = `Line ${cursorLine(input)}`
  }

  input.addEventListener('focus', () => {
    update()
    lineNumber.hidden = false
  })
  input.addEventListener('blur', () => {
    lineNumber.hidden = true
  })
  input.addEventListener('input', update)
  input.addEventListener('click', update)
  input.addEventListener('keyup', update)
  input.addEventListener('select', update)
}

export const initAllowListCursorLines = (root: ParentNode = document): void => {
  root
    .querySelectorAll<HTMLTextAreaElement>('textarea[data-allow-list-input]')
    .forEach(initialiseCursorLine)
}
