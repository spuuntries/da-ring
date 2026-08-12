import { merge, deriveView, filterValidOps, fromOps, createState } from '../crdt/index.js'
import type { Op, RingView } from '../crdt/index.js'
import { renderWidget } from './render.js'
import { escapeHtml, sanitizeView } from './sanitize.js'

async function fetchState(url: string): Promise<Op[] | null> {
  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 3000)

    const fetchUrl = url.endsWith('/webring.json')
      ? url
      : `${url.replace(/\/$/, '')}/webring.json`

    const response = await fetch(fetchUrl, { signal: controller.signal })
    clearTimeout(id)

    if (!response.ok) return null

    const ops = await response.json()
    if (!Array.isArray(ops)) return null

    return ops
  } catch {
    return null
  }
}

async function init() {
  const scriptTag = document.currentScript || document.querySelector('script[data-ring]')
  if (!scriptTag) return

  const bootstrapAttr = scriptTag.getAttribute('data-ring')
  if (!bootstrapAttr) return

  const currentUrl = window.location.origin

  const container = document.createElement('div')
  scriptTag.parentNode?.insertBefore(container, scriptTag.nextSibling)

  renderWidget(container, null, currentUrl, 'loading')

  const bootstrapUrls = bootstrapAttr.split(',').map(s => s.trim()).filter(Boolean)

  if (bootstrapUrls.length === 0) {
    renderWidget(container, null, currentUrl, 'error')
    return
  }

  // 1. Fetch from bootstrap URLs
  const fetchedUrls = new Set<string>()
  const results = await Promise.all(bootstrapUrls.map(async url => {
    fetchedUrls.add(url)
    const ops = await fetchState(url)
    return { url, ops }
  }))
  
  const validResults = results.filter((r): r is { url: string, ops: Op[] } => r.ops !== null)

  if (validResults.length === 0) {
    renderWidget(container, null, currentUrl, 'error')
    return
  }

  let mergedState = createState()
  for (const { url, ops } of validResults) {
    const validOps = filterValidOps(ops, mergedState, url, true)
    mergedState = merge(mergedState, fromOps(validOps))
  }

  // 2. Dynamic discovery loop — fetch from ALL members (not just actives)
  //    because a member might be active but we don't know yet if the
  //    bootstrap node hasn't synced their key-claim
  while (true) {
    const view = deriveView(mergedState)
    const unfetched = view.members
      .filter(m => !fetchedUrls.has(m.url))

    if (unfetched.length === 0) break

    const moreResults = await Promise.all(unfetched.map(async m => {
      fetchedUrls.add(m.url)
      const ops = await fetchState(m.url)
      return { url: m.url, ops }
    }))

    for (const { url, ops } of moreResults) {
      if (ops) {
        const validOps = filterValidOps(ops, mergedState, url, false)
        mergedState = merge(mergedState, fromOps(validOps))
      }
    }
  }

  // 3. Final view and render
  const finalView = deriveView(mergedState)
  


  const safeView = sanitizeView(finalView)
  const safeCurrentUrl = escapeHtml(currentUrl)

  if (safeView.members.length === 0) {
    renderWidget(container, safeView, safeCurrentUrl, 'empty')
  } else {
    renderWidget(container, safeView, safeCurrentUrl, 'loaded')
  }
}

// Auto-init when script loads
init()
