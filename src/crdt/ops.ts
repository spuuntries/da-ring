import { hash, sign } from '../crypto/keys.js'

// ── Operation Types ──────────────────────────────────────────────

export type OpType = 'genesis' | 'add' | 'key-claim' | 'revoke' | 'leave'

export interface BaseOp {
  /** SHA-256 hash of the canonical content (computed, not user-set) */
  id: string
  /** Operation type */
  type: OpType
  /** URL of the op author */
  author: string
  /** Ed25519 signature over the canonical content (hex) */
  sig: string
  /** Op IDs this author had seen when creating this op (causal deps) */
  seen: string[]
  /** Wall-clock timestamp (ms). For display only — ordering comes from the DAG */
  timestamp: number
}

export interface GenesisOp extends BaseOp {
  type: 'genesis'
  payload: {
    name: string
    inviteBudget: number
  }
}

export interface AddOp extends BaseOp {
  type: 'add'
  payload: {
    target: string
    name: string
  }
}

export interface KeyClaimOp extends BaseOp {
  type: 'key-claim'
  payload: {
    pubkey: string
  }
}

export interface RevokeOp extends BaseOp {
  type: 'revoke'
  payload: {
    target: string
    reparent?: boolean
  }
}

export interface LeaveOp extends BaseOp {
  type: 'leave'
  payload: Record<string, never>
}

export type Op = GenesisOp | AddOp | KeyClaimOp | RevokeOp | LeaveOp

// ── Canonical Serialization ──────────────────────────────────────

/** Canonical JSON for hashing/signing — deterministic key order, no id/sig */
function canonicalize(op: Omit<Op, 'id' | 'sig'>): string {
  const ordered: Record<string, unknown> = {
    type: op.type,
    author: op.author,
    timestamp: op.timestamp,
    seen: [...op.seen].sort(),
    payload: op.type === 'leave' ? {} : (op as any).payload,
  }
  return JSON.stringify(ordered)
}

/** Compute the op ID (SHA-256 of canonical content) */
export function computeOpId(op: Omit<Op, 'id' | 'sig'>): string {
  return hash(canonicalize(op))
}

/** Sign an op and return the completed op with id + sig */
export function signOp<T extends Op>(
  partial: Omit<T, 'id' | 'sig'>,
  privateKey: string,
): T {
  const canonical = canonicalize(partial)
  const id = hash(canonical)
  const sig = sign(canonical, privateKey)
  return { ...partial, id, sig } as T
}

// ── Op Constructors ──────────────────────────────────────────────

export function createGenesisOp(
  author: string,
  name: string,
  inviteBudget: number,
  privateKey: string,
): GenesisOp {
  return signOp<GenesisOp>({
    type: 'genesis',
    author,
    timestamp: Date.now(),
    seen: [],
    payload: { name, inviteBudget },
  }, privateKey)
}

export function createAddOp(
  author: string,
  target: string,
  name: string,
  seenIds: string[],
  privateKey: string,
): AddOp {
  return signOp<AddOp>({
    type: 'add',
    author,
    timestamp: Date.now(),
    seen: seenIds,
    payload: { target, name },
  }, privateKey)
}

export function createKeyClaimOp(
  author: string,
  pubkey: string,
  seenIds: string[],
  privateKey: string,
): KeyClaimOp {
  return signOp<KeyClaimOp>({
    type: 'key-claim',
    author,
    timestamp: Date.now(),
    seen: seenIds,
    payload: { pubkey },
  }, privateKey)
}

export function createRevokeOp(
  author: string,
  target: string,
  seenIds: string[],
  privateKey: string,
  reparent: boolean = false,
): RevokeOp {
  return signOp<RevokeOp>({
    type: 'revoke',
    author,
    timestamp: Date.now(),
    seen: seenIds,
    payload: { target, reparent },
  }, privateKey)
}

export function createLeaveOp(
  author: string,
  seenIds: string[],
  privateKey: string,
): LeaveOp {
  return signOp<LeaveOp>({
    type: 'leave',
    author,
    timestamp: Date.now(),
    seen: seenIds,
    payload: {},
  }, privateKey)
}
