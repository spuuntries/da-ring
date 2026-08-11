import type { RingView } from '../crdt/index.js'
import { getNeighbors } from '../crdt/index.js'

const styles = `
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --ring-bg: rgba(255, 255, 255, 0.92);
    --ring-border: rgba(0, 0, 0, 0.08);
    --ring-text: #333;
    --ring-accent: #8b5cf6;
    --ring-hover: rgba(139, 92, 246, 0.08);
    --ring-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
    --ring-radius: 10px;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --ring-bg: rgba(28, 28, 32, 0.92);
      --ring-border: rgba(255, 255, 255, 0.08);
      --ring-text: #e4e4e7;
      --ring-accent: #a78bfa;
      --ring-hover: rgba(167, 139, 250, 0.1);
      --ring-shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }

  .widget {
    background: var(--ring-bg);
    border: 1px solid var(--ring-border);
    border-radius: var(--ring-radius);
    box-shadow: var(--ring-shadow);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: var(--ring-text);
    max-width: 420px;
    margin: 0 auto;
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
    height: 42px;
  }

  .nav-link {
    text-decoration: none;
    color: var(--ring-text);
    padding: 6px 12px;
    border-radius: 6px;
    transition: background-color 0.2s ease, color 0.2s ease;
    font-size: 0.85em;
    letter-spacing: 0.02em;
    opacity: 0.8;
  }

  .nav-link:hover {
    background: var(--ring-hover);
    color: var(--ring-accent);
    opacity: 1;
  }

  .center {
    font-weight: 600;
    font-size: 0.88em;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 6px;
    transition: background-color 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
    letter-spacing: 0.01em;
  }

  .center:hover {
    background: var(--ring-hover);
  }

  .accent {
    color: var(--ring-accent);
    font-size: 0.75em;
  }

  .member-list {
    max-height: 0;
    overflow-y: auto;
    transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-top: 1px solid transparent;
  }

  .member-list.expanded {
    max-height: 220px;
    border-top-color: var(--ring-border);
  }

  .member-item {
    display: block;
    padding: 9px 16px;
    text-decoration: none;
    color: var(--ring-text);
    font-size: 0.85em;
    border-bottom: 1px solid var(--ring-border);
    transition: background-color 0.15s ease;
  }

  .member-item:last-child {
    border-bottom: none;
  }

  .member-item:hover {
    background: var(--ring-hover);
  }

  .member-item.current {
    border-left: 3px solid var(--ring-accent);
    padding-left: 13px;
    font-weight: 500;
    color: var(--ring-accent);
  }

  .member-name {
    opacity: 0.5;
    font-size: 0.9em;
    margin-left: 6px;
  }

  .status-msg {
    text-align: center;
    padding: 12px;
    font-size: 0.85em;
    opacity: 0.6;
  }

  .loading-dot {
    display: inline-block;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
`

type WidgetStatus = 'loading' | 'loaded' | 'error' | 'empty'

export function renderWidget(
  container: HTMLElement,
  view: RingView | null,
  currentUrl: string,
  status: WidgetStatus = 'loaded',
): void {
  if (!container.shadowRoot) {
    container.attachShadow({ mode: 'open' })
  }

  const root = container.shadowRoot!

  if (status === 'loading') {
    root.innerHTML = `<style>${styles}</style>
      <div class="widget"><div class="status-msg"><span class="loading-dot">·</span> loading ring <span class="loading-dot">·</span></div></div>`
    return
  }

  if (status === 'error') {
    root.innerHTML = `<style>${styles}</style>
      <div class="widget"><div class="status-msg">ring unavailable</div></div>`
    return
  }

  if (status === 'empty' || !view || view.members.length === 0) {
    root.innerHTML = `<style>${styles}</style>
      <div class="widget"><div class="status-msg">ring is empty</div></div>`
    return
  }

  const { prev, next } = getNeighbors(view.members, currentUrl)

  const memberListHtml = view.members.map(m => {
    const isCurrent = m.url === currentUrl
    return `<a class="member-item${isCurrent ? ' current' : ''}" href="${m.url}">${m.url}<span class="member-name">${m.name}</span></a>`
  }).join('')

  root.innerHTML = `
    <style>${styles}</style>
    <div class="widget">
      <div class="bar">
        <a class="nav-link" href="${prev?.url || '#'}" title="${prev?.name || 'previous'}">← prev</a>
        <div class="center" id="ring-title">
          <span class="accent">✦</span> ${view.name} <span class="accent">✦</span>
        </div>
        <a class="nav-link" href="${next?.url || '#'}" title="${next?.name || 'next'}">next →</a>
      </div>
      <div class="member-list" id="member-list">
        ${memberListHtml}
      </div>
    </div>
  `

  const titleBtn = root.getElementById('ring-title')
  const memberList = root.getElementById('member-list')

  if (titleBtn && memberList) {
    titleBtn.addEventListener('click', () => {
      memberList.classList.toggle('expanded')
    })
  }
}
