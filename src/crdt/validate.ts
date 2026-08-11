import { verify, hash } from '../crypto/keys.js'
import type { Op, KeyClaimOp } from './ops.js'
import type { RingState } from './state.js'

// ── Validation ───────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate a single op against the current state.
 * Checks signature, causal deps, and domain-specific rules.
 *
 * Note: For genesis ops, the pubkey is self-attested (key-claim comes with genesis).
 * For other ops, we look up the author's pubkey from their key-claim op.
 */
export function validateOp(op: Op, state: RingState): ValidationResult {
  const errors: string[] = []

  // 1. Check causal deps exist
  for (const depId of op.seen) {
    if (!state.has(depId)) {
      errors.push(`missing causal dependency: ${depId}`)
    }
  }

  // 2. Verify op ID matches content
  const expectedId = computeIdFromOp(op)
  if (op.id !== expectedId) {
    errors.push(`op ID mismatch: expected ${expectedId}, got ${op.id}`)
  }

  // 3. Look up author's pubkey for signature verification
  const pubkey = findPubkey(op.author, state)
  if (pubkey) {
    const canonical = canonicalizeForVerify(op)
    if (!verify(canonical, op.sig, pubkey)) {
      errors.push(`invalid signature for author ${op.author}`)
    }
  } else if (op.type !== 'genesis' && op.type !== 'key-claim') {
    // Genesis and key-claim ops are self-attesting — we verify them
    // when the key-claim is processed. Other ops need a known pubkey.
    errors.push(`no known pubkey for author ${op.author}`)
  }

  // 4. Type-specific validation
  switch (op.type) {
    case 'genesis': {
      // Must be the only genesis op
      for (const existing of state.values()) {
        if (existing.type === 'genesis') {
          errors.push('duplicate genesis op')
          break
        }
      }
      break
    }

    case 'add': {
      // Author must have a pubkey (be active)
      if (!pubkey) {
        errors.push(`author ${op.author} has no pubkey (not active)`)
      }
      break
    }

    case 'revoke': {
      if (!pubkey) {
        errors.push(`author ${op.author} has no pubkey (not active)`)
      }
      break
    }

    case 'leave': {
      if (!pubkey) {
        errors.push(`author ${op.author} has no pubkey (not active)`)
      }
      break
    }

    case 'key-claim': {
      // The key-claim is self-attesting: we verify the signature using
      // the pubkey IN the payload. This is trusted because the file is
      // served from the author's domain.
      const kc = op as KeyClaimOp
      const canonical = canonicalizeForVerify(op)
      if (!verify(canonical, op.sig, kc.payload.pubkey)) {
        errors.push(`key-claim signature does not match claimed pubkey`)
      }
      break
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate an entire ring state. Returns all errors found.
 */
export function validateState(state: RingState): ValidationResult {
  const errors: string[] = []
  let genesisCount = 0

  for (const op of state.values()) {
    if (op.type === 'genesis') genesisCount++

    const result = validateOp(op, state)
    errors.push(...result.errors)
  }

  if (genesisCount === 0) {
    errors.push('no genesis op found')
  } else if (genesisCount > 1) {
    errors.push(`found ${genesisCount} genesis ops, expected 1`)
  }

  return { valid: errors.length === 0, errors }
}

// ── Helpers ──────────────────────────────────────────────────────

/** Find the pubkey for a member from their key-claim op */
function findPubkey(author: string, state: RingState): string | null {
  for (const op of state.values()) {
    if (op.type === 'key-claim' && op.author === author) {
      return (op as KeyClaimOp).payload.pubkey
    }
  }
  return null
}

/** Recreate canonical content from an op (for ID verification) */
function canonicalizeForVerify(op: Op): string {
  const ordered: Record<string, unknown> = {
    type: op.type,
    author: op.author,
    timestamp: op.timestamp,
    seen: [...op.seen].sort(),
    payload: op.type === 'leave' ? {} : (op as any).payload,
  }
  return JSON.stringify(ordered)
}

/** Compute what the op ID should be from its content */
function computeIdFromOp(op: Op): string {
  return hash(canonicalizeForVerify(op))
}
