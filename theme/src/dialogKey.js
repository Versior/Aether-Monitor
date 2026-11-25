export function dialogKey(event, close) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const elements = [...event.currentTarget.querySelectorAll('button:enabled, select:enabled, input:enabled, a[href], [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = elements[0]
  const last = elements.at(-1)
  if (!first) return
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { last.focus(); event.preventDefault() }
  if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { first.focus(); event.preventDefault() }
}
