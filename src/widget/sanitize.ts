import type { RingView } from '../crdt/index.js'

export function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function sanitizeView(view: RingView): RingView {
  return {
    ...view,
    name: escapeHtml(view.name),
    members: view.members.map(m => ({
      ...m,
      name: escapeHtml(m.name),
      url: escapeHtml(m.url),
    }))
  }
}
