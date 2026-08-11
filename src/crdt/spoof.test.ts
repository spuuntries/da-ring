import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeypair } from '../crypto/keys.js'
import { createGenesisOp, createKeyClaimOp, createRevokeOp, createAddOp, type Op } from './ops.js'
import { merge, deriveView, fromOps, allOpIds } from './state.js'
import { filterValidOps } from './validate.js'

describe('security - transport-layer identity verification', () => {
  it('prevents attacker from hijacking genesis op via spoofed key-claim', () => {
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const trueState = fromOps([aliceGenesis, aliceKeyClaim])
    
    const bobKeys = generateKeypair()
    const fakeKeyClaim = createKeyClaimOp('https://alice.site', bobKeys.publicKey, [aliceGenesis.id], bobKeys.privateKey)
    const fakeGenesis = createGenesisOp('https://alice.site', 'HACKED RING', 99, bobKeys.privateKey)
    
    // Simulating widget fetching from bob.site (discovery loop)
    const filteredOps = filterValidOps([fakeKeyClaim, fakeGenesis], trueState, 'https://bob.site', false)
    const mergedState = merge(trueState, fromOps(filteredOps))
    const view = deriveView(mergedState)
    
    assert.equal(view.name, 'alice ring')
    assert.equal(mergedState.size, 2)
  })

  it('prevents attacker from revoking victim\'s invitees via spoofed key-claim', () => {
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const trueState = fromOps([aliceGenesis, aliceKeyClaim])

    // Alice legitimately invites Carol
    const carolAdd = createAddOp('https://alice.site', 'https://carol.site', 'carol', allOpIds(trueState), aliceKeys.privateKey)
    trueState.set(carolAdd.id, carolAdd)

    // Bob tries to spoof Alice to revoke Carol
    const bobKeys = generateKeypair()
    const fakeKeyClaim = createKeyClaimOp('https://alice.site', bobKeys.publicKey, allOpIds(trueState), bobKeys.privateKey)
    const fakeRevoke = createRevokeOp('https://alice.site', 'https://carol.site', allOpIds(trueState), bobKeys.privateKey)

    const filteredOps = filterValidOps([fakeKeyClaim, fakeRevoke], trueState, 'https://bob.site', false)
    const mergedState = merge(trueState, fromOps(filteredOps))
    const view = deriveView(mergedState)

    // Carol should still be in the ring
    assert.equal(view.members.length, 2)
    assert.ok(view.members.find(m => m.url === 'https://carol.site'))
    assert.equal(mergedState.size, 3) // genesis, key-claim, add
  })

  it('prevents attacker from using victim\'s invite slots via spoofed key-claim', () => {
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const trueState = fromOps([aliceGenesis, aliceKeyClaim])

    // Bob tries to spoof Alice to invite his spam site
    const bobKeys = generateKeypair()
    const fakeKeyClaim = createKeyClaimOp('https://alice.site', bobKeys.publicKey, allOpIds(trueState), bobKeys.privateKey)
    const fakeAdd = createAddOp('https://alice.site', 'https://spam.site', 'spam', allOpIds(trueState), bobKeys.privateKey)

    const filteredOps = filterValidOps([fakeKeyClaim, fakeAdd], trueState, 'https://bob.site', false)
    const mergedState = merge(trueState, fromOps(filteredOps))
    const view = deriveView(mergedState)

    // Spam site should not be in the ring
    assert.equal(view.members.length, 1)
    assert.equal(mergedState.size, 2)
  })

  it('drops duplicate genesis ops even if attacker uses their own valid key-claim', () => {
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const trueState = fromOps([aliceGenesis, aliceKeyClaim])

    // Bob is a legitimate member (or tries to be)
    const bobKeys = generateKeypair()
    const bobKeyClaim = createKeyClaimOp('https://bob.site', bobKeys.publicKey, allOpIds(trueState), bobKeys.privateKey)
    // But Bob tries to push a second genesis op!
    const fakeGenesis = createGenesisOp('https://bob.site', 'bobs ring', 99, bobKeys.privateKey)

    // Bob's key-claim is legit since it comes from bob.site, but the genesis op should be rejected
    const filteredOps = filterValidOps([bobKeyClaim, fakeGenesis], trueState, 'https://bob.site', false)
    const mergedState = merge(trueState, fromOps(filteredOps))
    
    // Bob's key claim should merge, but fake genesis should not
    assert.equal(mergedState.has(fakeGenesis.id), false, 'Duplicate genesis should be dropped')
  })

  it('accepts gossiped key-claims ONLY from trusted bootstrap nodes', () => {
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const trueState = fromOps([aliceGenesis, aliceKeyClaim])

    // Carol is a passive member being added by Alice
    const carolAdd = createAddOp('https://alice.site', 'https://carol.site', 'carol', allOpIds(trueState), aliceKeys.privateKey)
    trueState.set(carolAdd.id, carolAdd)
    
    // Carol later becomes active and generates a key-claim
    const carolKeys = generateKeypair()
    const carolKeyClaim = createKeyClaimOp('https://carol.site', carolKeys.publicKey, allOpIds(trueState), carolKeys.privateKey)
    
    // SCENARIO A: Widget fetches from Alice (bootstrap node) and Alice gossips Carol's key-claim
    const opsFromAlice = [carolKeyClaim]
    // isBootstrap = true, so we accept Carol's key-claim even though it comes from Alice
    const filteredBootstrap = filterValidOps(opsFromAlice, trueState, 'https://alice.site', true)
    assert.equal(filteredBootstrap.length, 1, 'Should accept gossiped key-claim from bootstrap node')

    // SCENARIO B: Widget fetches from Bob (discovery node) and Bob gossips Carol's key-claim
    const opsFromBob = [carolKeyClaim]
    // isBootstrap = false, so we reject Carol's key-claim because it didn't come from Carol
    const filteredDiscovery = filterValidOps(opsFromBob, trueState, 'https://bob.site', false)
    assert.equal(filteredDiscovery.length, 0, 'Should reject gossiped key-claim from untrusted discovery node')
  })
})
