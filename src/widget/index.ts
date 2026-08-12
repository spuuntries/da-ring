import { merge, deriveView, filterValidOps, fromOps, createState, serialize, deserialize, slugify } from '../crdt/index.js'
import type { Op, RingView } from '../crdt/index.js'
import { renderWidget } from './render.js'
import { escapeHtml, sanitizeView } from './sanitize.js'

async function fetchState(url: string, ringName: string): Promise<Op[] | null> {
  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 3000)

    const fetchUrl = `${url.replace(/\/$/, '')}/${ringName}.json`

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

  const rawRingName = scriptTag.getAttribute('data-ring-name')
  if (!rawRingName) {
    const container = document.createElement('div')
    scriptTag.parentNode?.insertBefore(container, scriptTag.nextSibling)
    container.innerHTML = `<div style="color:red;padding:10px;border:1px solid red;border-radius:4px;font-family:sans-serif;font-size:12px;">da-ring error: missing data-ring-name attribute</div>`
    return
  }
  const ringName = slugify(rawRingName)

  const bootstrapAttr = scriptTag.getAttribute('data-ring')
  if (!bootstrapAttr) return

  const currentUrl = window.location.origin

  const container = document.createElement('div')
  scriptTag.parentNode?.insertBefore(container, scriptTag.nextSibling)

  const bootstrapUrls = bootstrapAttr.split(',').map(s => s.trim()).filter(Boolean)

  if (bootstrapUrls.length === 0) {
    renderWidget(container, null, currentUrl, 'error')
    return
  }

  const cacheKey = `da-ring-cache-${ringName}`
  let mergedState = createState()
  let hasCachedView = false

  // 1. Try to load from cache and render instantly
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const ops = JSON.parse(cached)
      if (Array.isArray(ops)) {
        mergedState = deserialize(ops)
        const view = deriveView(mergedState)
        const safeView = sanitizeView(view)
        const safeCurrentUrl = escapeHtml(currentUrl)
        renderWidget(container, safeView, safeCurrentUrl, safeView.members.length === 0 ? 'empty' : 'loaded')
        hasCachedView = true
      }
    }
  } catch (e) {
    // Ignore cache errors
  }

  if (!hasCachedView) {
    renderWidget(container, null, currentUrl, 'loading')
  }

  // 2. Fetch from bootstrap URLs
  const fetchedUrls = new Set<string>()
  const results = await Promise.all(bootstrapUrls.map(async url => {
    fetchedUrls.add(url)
    const ops = await fetchState(url, ringName)
    return { url, ops }
  }))
  
  const validResults = results.filter((r): r is { url: string, ops: Op[] } => r.ops !== null)

  if (validResults.length === 0 && !hasCachedView) {
    renderWidget(container, null, currentUrl, 'error')
    return
  }

  for (const { url, ops } of validResults) {
    const validOps = filterValidOps(ops, mergedState, url, true)
    mergedState = merge(mergedState, fromOps(validOps))
  }

  // Render immediately after bootstrap if we didn't have a cache (first-time visitor)
  if (!hasCachedView) {
    const bootstrapView = deriveView(mergedState)
    const safeBootstrapView = sanitizeView(bootstrapView)
    const safeCurrentUrl = escapeHtml(currentUrl)
    renderWidget(container, safeBootstrapView, safeCurrentUrl, safeBootstrapView.members.length === 0 ? 'empty' : 'loaded')
  }

  // 3. Dynamic discovery loop — fetch from ALL members (not just actives)
  //    because a member might be active but we don't know yet if the
  //    bootstrap node hasn't synced their key-claim
  while (true) {
    const view = deriveView(mergedState)
    const unfetched = view.members
      .filter(m => !fetchedUrls.has(m.url))

    if (unfetched.length === 0) break

    const moreResults = await Promise.all(unfetched.map(async m => {
      fetchedUrls.add(m.url)
      const ops = await fetchState(m.url, ringName)
      return { url: m.url, ops }
    }))

    for (const { url, ops } of moreResults) {
      if (ops) {
        const validOps = filterValidOps(ops, mergedState, url, false)
        mergedState = merge(mergedState, fromOps(validOps))
      }
    }
  }

  // 4. Final view, render, and cache
  const finalView = deriveView(mergedState)
  const safeView = sanitizeView(finalView)
  const safeCurrentUrlFinal = escapeHtml(currentUrl)

  if (safeView.members.length === 0) {
    renderWidget(container, safeView, safeCurrentUrlFinal, 'empty')
  } else {
    renderWidget(container, safeView, safeCurrentUrlFinal, 'loaded')
  }

  // Save the final merged state back to cache
  try {
    const opsToCache = serialize(mergedState)
    localStorage.setItem(cacheKey, JSON.stringify(opsToCache))
  } catch (e) {
    // Ignore cache save errors (e.g., quota exceeded)
  }
}

// Auto-init when script loads
init()
