const countLines = (value: string): number =>
  value
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean).length

const countText = (value: string): string =>
  `One per line. ${countLines(value)} listed.`

const initialiseCount = (root: ParentNode, input: HTMLTextAreaElement) => {
  const targetId = input.dataset.countTarget
  const target = targetId
    ? root.querySelector<HTMLElement>(`#${targetId}`)
    : null

  if (!target) {
    return
  }

  const update = () => {
    target.textContent = countText(input.value)
  }

  update()
  input.addEventListener('input', update)
}

export const initAllowListCounts = (root: ParentNode = document): void => {
  root
    .querySelectorAll<HTMLTextAreaElement>('textarea[data-allow-list-input]')
    .forEach((input) => initialiseCount(root, input))
}
