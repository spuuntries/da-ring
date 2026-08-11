import { deserialize, merge, deriveView } from '../crdt/index.js'
import type { RingState } from '../crdt/index.js'
import { renderWidget } from './render.js'

async function fetchState(url: string): Promise<RingState | null> {
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

    return deserialize(ops)
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
  const results = await Promise.all(bootstrapUrls.map(url => {
    fetchedUrls.add(url)
    return fetchState(url)
  }))
  const validStates = results.filter((s): s is RingState => s !== null)

  if (validStates.length === 0) {
    renderWidget(container, null, currentUrl, 'error')
    return
  }

  let mergedState = validStates[0]
  for (let i = 1; i < validStates.length; i++) {
    mergedState = merge(mergedState, validStates[i])
  }

  // 2. Dynamic discovery loop — fetch from ALL members (not just actives)
  //    because a member might be active but we don't know yet if the
  //    bootstrap node hasn't synced their key-claim
  while (true) {
    const view = deriveView(mergedState)
    const unfetched = view.members
      .filter(m => !fetchedUrls.has(m.url))

    if (unfetched.length === 0) break

    const moreResults = await Promise.all(unfetched.map(m => {
      fetchedUrls.add(m.url)
      return fetchState(m.url)
    }))

    for (const state of moreResults) {
      if (state) {
        mergedState = merge(mergedState, state)
      }
    }
  }

  // 3. Final view and render
  const finalView = deriveView(mergedState)

  if (finalView.members.length === 0) {
    renderWidget(container, finalView, currentUrl, 'empty')
  } else {
    renderWidget(container, finalView, currentUrl, 'loaded')
  }
}

// Auto-init when script loads
init()
