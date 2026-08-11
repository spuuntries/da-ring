import { deserialize, serialize, merge, deriveView } from '../crdt/index.js'
import type { RingState } from '../crdt/index.js'
import fs from 'node:fs'
import path from 'node:path'

const KEYS_DIR = '.da-ring'
const KEYS_FILE = 'keys.json'
const STATE_FILE = 'webring.json'

function keysPath(): string {
  return path.join(process.cwd(), KEYS_DIR, KEYS_FILE)
}

function statePath(): string {
  return path.join(process.cwd(), STATE_FILE)
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

export function loadState(): RingState {
  const p = statePath()
  if (!fs.existsSync(p)) return new Map()
  const ops = JSON.parse(fs.readFileSync(p, 'utf-8'))
  return deserialize(ops)
}

export function saveState(state: RingState): void {
  fs.writeFileSync(statePath(), JSON.stringify(serialize(state), null, 2))
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

export async function fetchRemoteState(url: string): Promise<RingState> {
  const target = new URL('/webring.json', url).href
  const res = await fetch(target)
  if (!res.ok) throw new Error(`failed to fetch state from ${target}: ${res.status}`)
  const ops = await res.json()
  return deserialize(ops)
}

export async function syncWithPeers(state: RingState): Promise<RingState> {
  const view = deriveView(state)
  let merged = state

  for (const memberUrl of view.activeMembers) {
    try {
      const remote = await fetchRemoteState(memberUrl)
      merged = merge(merged, remote)
    } catch {
      // skip unreachable peers
    }
  }

  return merged
}
