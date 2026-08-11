import { hash } from '../crypto/keys.js'
import type { Op, GenesisOp, AddOp, KeyClaimOp, RevokeOp, LeaveOp } from './ops.js'

// ── Ring State (the G-Set CRDT) ──────────────────────────────────

/** The CRDT state: a grow-only set of operations, keyed by op ID */
export type RingState = Map<string, Op>

/** Create an empty ring state */
export function createState(): RingState {
  return new Map()
}

/** Create a ring state from an array of ops */
export function fromOps(ops: Op[]): RingState {
  const state: RingState = new Map()
  for (const op of ops) {
    state.set(op.id, op)
  }
  return state
}

/** Merge two ring states (set union — commutative, associative, idempotent) */
export function merge(a: RingState, b: RingState): RingState {
  const merged: RingState = new Map(a)
  for (const [id, op] of b) {
    if (!merged.has(id)) {
      merged.set(id, op)
    }
  }
  return merged
}

/** Serialize ring state to JSON-safe format */
export function serialize(state: RingState): Op[] {
  return [...state.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Deserialize from JSON array */
export function deserialize(ops: Op[]): RingState {
  return fromOps(ops)
}

/** Get all op IDs in the state (for `seen` fields) */
export function allOpIds(state: RingState): string[] {
  return [...state.keys()]
}

// ── Derived View ─────────────────────────────────────────────────

export interface Member {
  url: string
  name: string
  invitedBy: string | null  // null for genesis member
  pubkey: string | null     // null if passive (no key-claim)
  isActive: boolean         // has a key-claim op
  depth: number             // depth in invite tree (genesis = 0)
}

export interface RingView {
  /** Ring name from genesis */
  name: string
  /** Invite budget from genesis */
  inviteBudget: number
  /** Current members in ring order */
  members: Member[]
  /** Invite tree: member URL → list of invitee URLs */
  inviteTree: Map<string, string[]>
  /** Active member URLs (those with key-claim ops, have webring.json) */
  activeMembers: string[]
  /** Per-member remaining invite slots */
  inviteSlots: Map<string, number>
  /** The genesis op */
  genesis: GenesisOp | null
}

/**
 * Topologically sort ops by causal DAG.
 * Ops that causally depend on others come after them.
 * Ties (concurrent ops) broken by op ID hash for determinism.
 */
function topoSort(state: RingState): Op[] {
  const ops = [...state.values()]
  const visited = new Set<string>()
  const sorted: Op[] = []

  // Build adjacency: op depends on its `seen` ops
  function visit(op: Op) {
    if (visited.has(op.id)) return
    visited.add(op.id)

    // Visit dependencies first
    for (const depId of op.seen) {
      const dep = state.get(depId)
      if (dep) visit(dep)
    }

    sorted.push(op)
  }

  // Sort ops by ID first for deterministic tie-breaking
  ops.sort((a, b) => a.id.localeCompare(b.id))
  for (const op of ops) {
    visit(op)
  }

  return sorted
}

/**
 * Derive the current ring view from the CRDT state.
 *
 * Replays all ops in causal order to compute:
 * - Current member set (accounting for revocations and leaves)
 * - Invite tree structure
 * - Active members
 * - Remaining invite slots
 */
export function deriveView(state: RingState): RingView {
  const sorted = topoSort(state)

  // State we build up during replay
  const members = new Map<string, Member>()        // url → member
  const inviteTree = new Map<string, string[]>()    // inviter → invitees
  const inviterOf = new Map<string, string>()       // url → inviter url
  const activeMembers = new Set<string>()
  const invitesUsed = new Map<string, number>()     // url → # invites used
  let genesis: GenesisOp | null = null
  let ringName = 'webring'
  let inviteBudget = 2

  // Track revoked members for cascade
  const revoked = new Set<string>()

  for (const op of sorted) {
    switch (op.type) {
      case 'genesis': {
        const g = op as GenesisOp
        genesis = g
        ringName = g.payload.name
        inviteBudget = g.payload.inviteBudget

        // Genesis author is the first member
        members.set(g.author, {
          url: g.author,
          name: g.author,  // genesis member uses URL as name initially
          invitedBy: null,
          pubkey: null,
          isActive: false,
          depth: 0,
        })
        inviteTree.set(g.author, [])
        invitesUsed.set(g.author, 0)
        break
      }

      case 'add': {
        const a = op as AddOp
        // Skip if author is not a current member or is revoked
        if (!members.has(a.author) || revoked.has(a.author)) break
        // Skip if target already exists
        if (members.has(a.payload.target)) break
        // Check invite budget
        const used = invitesUsed.get(a.author) ?? 0
        if (used >= inviteBudget) break

        const inviterMember = members.get(a.author)!
        members.set(a.payload.target, {
          url: a.payload.target,
          name: a.payload.name,
          invitedBy: a.author,
          pubkey: null,
          isActive: false,
          depth: inviterMember.depth + 1,
        })
        inviterOf.set(a.payload.target, a.author)

        // Update invite tree
        const children = inviteTree.get(a.author) ?? []
        children.push(a.payload.target)
        inviteTree.set(a.author, children)
        inviteTree.set(a.payload.target, [])

        invitesUsed.set(a.author, used + 1)
        break
      }

      case 'key-claim': {
        const k = op as KeyClaimOp
        // Must be an existing member
        const member = members.get(k.author)
        if (!member || revoked.has(k.author)) break

        member.pubkey = k.payload.pubkey
        member.isActive = true
        activeMembers.add(k.author)
        break
      }

      case 'revoke': {
        const r = op as RevokeOp
        // Author must be the direct inviter of target
        if (revoked.has(r.author)) break
        if (inviterOf.get(r.payload.target) !== r.author) break

        // Cascade: revoke target and entire subtree
        const toRevoke = [r.payload.target]
        while (toRevoke.length > 0) {
          const url = toRevoke.pop()!
          if (revoked.has(url)) continue
          revoked.add(url)
          members.delete(url)
          activeMembers.delete(url)

          // Cascade to children
          const children = inviteTree.get(url) ?? []
          toRevoke.push(...children)
        }

        // Give the inviter their invite slot back
        const used = invitesUsed.get(r.author) ?? 0
        invitesUsed.set(r.author, Math.max(0, used - 1))
        break
      }

      case 'leave': {
        const l = op as LeaveOp
        // Must be an existing member
        if (!members.has(l.author) || revoked.has(l.author)) break

        const inviter = inviterOf.get(l.author)

        // Re-parent children to the leaver's inviter
        const children = inviteTree.get(l.author) ?? []
        if (inviter) {
          const inviterChildren = inviteTree.get(inviter) ?? []
          for (const child of children) {
            inviterOf.set(child, inviter)
            const childMember = members.get(child)
            if (childMember) {
              childMember.invitedBy = inviter
              // Recalculate depth
              const inviterMember = members.get(inviter)
              if (inviterMember) childMember.depth = inviterMember.depth + 1
            }
            inviterChildren.push(child)
          }
          inviteTree.set(inviter, inviterChildren.filter(c => c !== l.author))

          // Give inviter back the slot
          const used = invitesUsed.get(inviter) ?? 0
          invitesUsed.set(inviter, Math.max(0, used - 1))
        }

        // Remove the member
        members.delete(l.author)
        activeMembers.delete(l.author)
        inviteTree.delete(l.author)
        break
      }
    }
  }

  // Compute invite slots remaining
  const inviteSlots = new Map<string, number>()
  for (const [url] of members) {
    const used = invitesUsed.get(url) ?? 0
    inviteSlots.set(url, inviteBudget - used)
  }

  return {
    name: ringName,
    inviteBudget,
    members: deriveRingOrder([...members.values()]),
    inviteTree,
    activeMembers: [...activeMembers],
    inviteSlots,
    genesis,
  }
}

/**
 * Deterministic ring order: sort members by SHA-256 hash of their URL.
 * Everyone with the same member set computes the same order.
 */
export function deriveRingOrder(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const ha = hash(a.url)
    const hb = hash(b.url)
    return ha.localeCompare(hb)
  })
}

/**
 * Get the next and previous members in the ring for a given URL.
 */
export function getNeighbors(members: Member[], currentUrl: string): { prev: Member | null, next: Member | null } {
  if (members.length === 0) return { prev: null, next: null }

  const idx = members.findIndex(m => m.url === currentUrl)
  if (idx === -1) {
    // Not in the ring — just return first/last as neighbors
    return { prev: members[members.length - 1], next: members[0] }
  }

  const prev = members[(idx - 1 + members.length) % members.length]
  const next = members[(idx + 1) % members.length]
  return { prev, next }
}
