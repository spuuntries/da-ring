import { deserialize, serialize, merge, deriveView, filterValidOps, fromOps, slugify } from '../crdt/index.js'
import type { RingState, Op } from '../crdt/index.js'
import fs from 'node:fs'
import path from 'node:path'

const KEYS_DIR = '.da-ring'
const KEYS_FILE = 'keys.json'

function keysPath(): string {
  return path.join(process.cwd(), KEYS_DIR, KEYS_FILE)
}

export async function statePath(): Promise<string> {
  const config = await loadRingConfig()
  return path.join(process.cwd(), `${slugify(config.name)}.json`)
}

export interface LocalKeys {
  publicKey: string
  privateKey: string
  url: string
}

export function loadKeys(): LocalKeys | null {
  const p = keysPath()
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

export function saveKeys(keys: LocalKeys): void {
  const dir = path.join(process.cwd(), KEYS_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(keysPath(), JSON.stringify(keys, null, 2))
}

export async function loadState(): Promise<RingState> {
  const p = await statePath()
  if (!fs.existsSync(p)) return new Map()
  const ops = JSON.parse(fs.readFileSync(p, 'utf-8'))
  return deserialize(ops)
}

export async function saveState(state: RingState): Promise<void> {
  const p = await statePath()
  fs.writeFileSync(p, JSON.stringify(serialize(state), null, 2))
}

export async function loadRingConfig(): Promise<{ name: string; inviteBudget: number }> {
  // Default config if ring.config.ts can't be loaded
  const defaults = { name: 'my webring', inviteBudget: 2 }
  try {
    const configPath = path.join(process.cwd(), 'ring.config.ts')
    const mod = await import(`file://${configPath}`)
    return { ...defaults, ...mod.default }
  } catch {
    try {
      const configPath = path.join(process.cwd(), 'ring.config.js')
      const mod = await import(`file://${configPath}`)
      return { ...defaults, ...mod.default }
    } catch {
      return defaults
    }
  }
}

export async function fetchRemoteState(url: string, ringName: string): Promise<Op[]> {
  const target = `${url.replace(/\/$/, '')}/${slugify(ringName)}.json`
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(target, { signal: controller.signal })
    if (!res.ok) throw new Error(`failed to fetch state from ${target}: ${res.status}`)
    const ops = await res.json()
    return ops
  } finally {
    clearTimeout(id)
  }
}

export async function syncWithPeers(state: RingState, ringName: string): Promise<RingState> {
  let merged = state
  const fetchedUrls = new Set<string>()

  while (true) {
    const view = deriveView(merged)
    const unfetched = view.members.filter(m => !fetchedUrls.has(m.url))

    if (unfetched.length === 0) {
      break
    }

    for (const member of unfetched) {
      fetchedUrls.add(member.url)
      try {
        const remoteOps = await fetchRemoteState(member.url, ringName)
        const validOps = filterValidOps(remoteOps, merged, member.url, false)
        merged = merge(merged, fromOps(validOps))
      } catch {
        // skip unreachable peers
      }
    }
  }

  return merged
}
