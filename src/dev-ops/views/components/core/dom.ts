import { svg } from './layer.ts'

type Attrs = Record<string, string | number | boolean | null | undefined>

/** An element with attributes (false/null/undefined left out, true as an empty attribute) and children. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue
    if (k === 'className') node.className = String(v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c != null && c !== false) node.append(c)
  return node
}

const sizes = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const

/** An icon the server put in a `<template data-au-icons>` under `root`, at a named size. */
export const icon = (root: ParentNode, name: string, size: keyof typeof sizes = 'md', cls = 'au-icon') => svg(root, name, sizes[size], cls)

/** A Button: `au-btn au-btn-{variant} au-btn-{size}` and the text in a span. */
export const button = (text: string, o: { variant?: string; size?: string; className?: string; attrs?: Attrs } = {}) =>
  el('button', { type: 'button', className: ['au-btn', `au-btn-${o.variant ?? 'default'}`, `au-btn-${o.size ?? 'md'}`, o.className].filter(Boolean).join(' '), ...o.attrs }, el('span', {}, text))

/** An IconButton without its tooltip: tertiary, the icon a size down for xs and sm. */
export const iconButton = (root: ParentNode, name: string, label: string, o: { size?: 'xs' | 'sm' | 'md'; className?: string; attrs?: Attrs } = {}) => {
  const s = o.size ?? 'md'
  return el('button', { type: 'button', className: ['au-btn', 'au-btn-tertiary', `au-btn-${s}`, 'au-btn-icon', o.className].filter(Boolean).join(' '), 'aria-label': label, ...o.attrs }, icon(root, name, s === 'xs' || s === 'sm' ? 'sm' : 'md'))
}

/** What can take focus inside a panel. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
