import { verify, hash } from '../crypto/keys.js'
import type { Op, KeyClaimOp } from './ops.js'
import { normalizeUrl } from './utils.js'
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

  // 3. Look up author's pubkeys for signature verification
  const pubkeys = findAllPubkeys(op.author, state)
  if (pubkeys.length > 0) {
    const canonical = canonicalizeForVerify(op)
    let anyValid = false
    for (const pk of pubkeys) {
      if (verify(canonical, op.sig, pk)) {
        anyValid = true
        break
      }
    }
    if (!anyValid) {
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
      if (pubkeys.length === 0) {
        errors.push(`author ${op.author} has no pubkey (not active)`)
      }
      break
    }

    case 'revoke': {
      if (pubkeys.length === 0) {
        errors.push(`author ${op.author} has no pubkey (not active)`)
      }
      break
    }

    case 'leave': {
      if (pubkeys.length === 0) {
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

/** Find all pubkeys published by a member (multiple key-claims allowed for rotation) */
function findAllPubkeys(author: string, state: RingState): string[] {
  const keys: string[] = []
  const targetAuthor = normalizeUrl(author)
  for (const op of state.values()) {
    if (op.type === 'key-claim' && normalizeUrl(op.author) === targetAuthor) {
      keys.push((op as KeyClaimOp).payload.pubkey)
    }
  }
  return keys
}

/** Recreate canonical content from an op (for ID verification) */
export function canonicalizeForVerify(op: Op): string {
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

// ── Transport-Layer Filtering ────────────────────────────────────

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Filter an array of ops fetched from `sourceUrl`, given the currently known valid state.
 * Returns only the ops that are valid and should be merged.
 */
export function filterValidOps(
  newOps: Op[],
  currentState: RingState,
  sourceUrl: string,
  isBootstrap: boolean = false
): Op[] {
  const valid: Op[] = []
  const tempState = new Map(currentState)
  
  // Helper to safely get origin
  const getOrigin = (url: string) => {
    try { return new URL(url).origin } catch { return url }
  }
  const sourceOrigin = getOrigin(sourceUrl)

  // 1. Process key-claims first so we can verify other ops in the payload
  for (const op of newOps) {
    if (op.type === 'key-claim') {
      const kc = op as KeyClaimOp
      
      if (!isBootstrap) {
        // Untrusted gossip: only trust if it came directly from the author's domain.
        // We now allow multiple key-claims (key rotation) as long as they pass this check.
        const authorOrigin = getOrigin(kc.author)
        if (authorOrigin !== sourceOrigin) continue
      }
      
      // Verify self-attesting signature
      const canonical = canonicalizeForVerify(kc)
      if (verify(canonical, kc.sig, kc.payload.pubkey)) {
        tempState.set(kc.id, kc)
        valid.push(kc)
      }
    }
  }

  // Check if we already have a genesis op
  const hasGenesis = [...currentState.values()].some(o => o.type === 'genesis')
  
  // 2. Process all other ops
  for (const op of newOps) {
    if (op.type === 'key-claim') continue // already processed
    
    if (op.type === 'genesis') {
      if (hasGenesis && !currentState.has(op.id)) {
        continue // Reject duplicate/conflicting genesis ops
      }
      if (!isSafeUrl(op.author)) {
        continue // Reject unsafe genesis URL
      }
    } else if (op.type === 'add') {
      if (!isSafeUrl((op as any).payload.target)) {
        continue // Reject unsafe target URL
      }
    }

    const pubkeys = findAllPubkeys(op.author, tempState)
    if (pubkeys.length === 0) continue // No known pubkey, cannot verify signature

    const canonical = canonicalizeForVerify(op)
    let anyValid = false
    for (const pk of pubkeys) {
      if (verify(canonical, op.sig, pk)) {
        anyValid = true
        break
      }
    }
    
    if (anyValid) {
      tempState.set(op.id, op)
      valid.push(op)
    }
  }
  
  return valid
}
