import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeypair } from '../crypto/keys.js'
import { createGenesisOp, createAddOp, createKeyClaimOp } from './ops.js'
import { filterValidOps } from './validate.js'

describe('validate', () => {
  it('transport layer - URL sanitization check', () => {
    const keys = generateKeypair()
    const aliceUrl = 'https://alice.site'
    
    // Valid genesis
    const genesis = createGenesisOp(aliceUrl, 'test ring', 2, keys.privateKey)
    const keyClaim = createKeyClaimOp(aliceUrl, keys.publicKey, [genesis.id], keys.privateKey)
    
    // Malicious add with javascript: url
    const maliciousAdd = createAddOp(
      aliceUrl, 
      'javascript:alert(1)', 
      'hacker', 
      [genesis.id, keyClaim.id], 
      keys.privateKey
    )
    
    const state = new Map()
    const validOps = filterValidOps([genesis, keyClaim, maliciousAdd], state, aliceUrl, true)
    
    const addedMalicious = validOps.find(op => op.type === 'add' && (op as any).payload.target === 'javascript:alert(1)')
    
    // The test expects the transport layer to NOT include the malicious op
    assert.ok(
      !addedMalicious,
      'Test failed: Malicious URL was accepted by filterValidOps'
    )
  })
})
