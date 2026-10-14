const visibleErrorLimit = 10

export const initAllowListErrorToggle = (root: ParentNode = document): void => {
  const list = root.querySelector<HTMLUListElement>(
    '[data-allow-list-errors] .govuk-error-summary__list'
  )
  if (!list) {
    return
  }

  const errors = Array.from(list.querySelectorAll<HTMLLIElement>('li'))
  if (errors.length <= visibleErrorLimit) {
    return
  }

  const description = list.ownerDocument.createElement('p')
  description.className = 'govuk-body'
  const button = list.ownerDocument.createElement('button')
  button.type = 'button'
  button.className = 'govuk-link app-allow-list-error-toggle'
  list.id = 'allow-list-error-list'
  button.setAttribute('aria-controls', list.id)

  let expanded = false
  const update = () => {
    errors.forEach((error, index) => {
      error.hidden = !expanded && index >= visibleErrorLimit
    })
    description.textContent = `There are ${errors.length} errors. ${
      expanded ? 'Showing all errors.' : 'Showing the first 10.'
    }`
    button.textContent = expanded
      ? 'Show fewer errors'
      : `View all ${errors.length} errors`
    button.setAttribute('aria-expanded', String(expanded))
  }

  button.addEventListener('click', () => {
    expanded = !expanded
    update()
  })
  update()
  list.before(description)
  list.after(button)
}
