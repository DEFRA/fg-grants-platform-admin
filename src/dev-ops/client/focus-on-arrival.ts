const focusOnArrival = () =>
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>('[data-focus-on-arrival]')
      ?.focus({ preventScroll: true })
  )

if (document.readyState === 'complete') {
  focusOnArrival()
} else {
  window.addEventListener('load', focusOnArrival, { once: true })
}
