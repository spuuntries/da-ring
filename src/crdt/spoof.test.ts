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

  it('allows key rotation via soft-revoke and re-invite', () => {
    // 1. Alice creates the ring
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const state = fromOps([aliceGenesis, aliceKeyClaim])

    // 2. Alice adds Bob
    const bobKeysOld = generateKeypair()
    const bobAdd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(state), aliceKeys.privateKey)
    state.set(bobAdd.id, bobAdd)
    const bobKeyClaim1 = createKeyClaimOp('https://bob.site', bobKeysOld.publicKey, allOpIds(state), bobKeysOld.privateKey)
    state.set(bobKeyClaim1.id, bobKeyClaim1)

    // Bob (with Key 1) invites Carol
    const carolAdd = createAddOp('https://bob.site', 'https://carol.site', 'carol', allOpIds(state), bobKeysOld.privateKey)
    state.set(carolAdd.id, carolAdd)

    // 3. Bob loses Key 1. Alice SOFT-revokes Bob.
    const softRevoke = createRevokeOp('https://alice.site', 'https://bob.site', allOpIds(state), aliceKeys.privateKey, true)
    state.set(softRevoke.id, softRevoke)

    // 4. Alice re-invites Bob
    const bobReadd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(state), aliceKeys.privateKey)
    state.set(bobReadd.id, bobReadd)

    // 5. Bob claims NEW Key 2
    const bobKeysNew = generateKeypair()
    const bobKeyClaim2 = createKeyClaimOp('https://bob.site', bobKeysNew.publicKey, allOpIds(state), bobKeysNew.privateKey)
    state.set(bobKeyClaim2.id, bobKeyClaim2)

    // 6. Bob successfully invites Dave with his NEW key
    const daveAdd = createAddOp('https://bob.site', 'https://dave.site', 'dave', allOpIds(state), bobKeysNew.privateKey)
    state.set(daveAdd.id, daveAdd)

    const view = deriveView(state)

    // Verify Carol was saved and re-parented to Alice
    const carol = view.members.find(m => m.url === 'https://carol.site')
    assert.ok(carol, 'Carol should be saved')
    assert.equal(carol.invitedBy, 'https://alice.site', 'Carol should be reparented to Alice')

    // Verify Bob is active with his new key
    const bob = view.members.find(m => m.url === 'https://bob.site')
    assert.ok(bob && bob.isActive, 'Bob should be active again')
    assert.equal(bob.pubkey, bobKeysNew.publicKey, 'Bob should be using the new key')

    // Verify Dave was successfully invited by Bob using the new key
    assert.ok(view.members.find(m => m.url === 'https://dave.site'), 'Dave should be successfully invited with new key')
  })

  it('blocks forgery attempt using a stolen old key after rotation', () => {
    // Setup identical to the previous test up to step 5
    const aliceKeys = generateKeypair()
    const aliceGenesis = createGenesisOp('https://alice.site', 'alice ring', 2, aliceKeys.privateKey)
    const aliceKeyClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, [aliceGenesis.id], aliceKeys.privateKey)
    const state = fromOps([aliceGenesis, aliceKeyClaim])

    const bobKeysOld = generateKeypair()
    const bobAdd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(state), aliceKeys.privateKey)
    state.set(bobAdd.id, bobAdd)
    const bobKeyClaim1 = createKeyClaimOp('https://bob.site', bobKeysOld.publicKey, allOpIds(state), bobKeysOld.privateKey)
    state.set(bobKeyClaim1.id, bobKeyClaim1)

    const softRevoke = createRevokeOp('https://alice.site', 'https://bob.site', allOpIds(state), aliceKeys.privateKey, true)
    state.set(softRevoke.id, softRevoke)

    const bobReadd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(state), aliceKeys.privateKey)
    state.set(bobReadd.id, bobReadd)

    const bobKeysNew = generateKeypair()
    const bobKeyClaim2 = createKeyClaimOp('https://bob.site', bobKeysNew.publicKey, allOpIds(state), bobKeysNew.privateKey)
    state.set(bobKeyClaim2.id, bobKeyClaim2)

    // Attacker (with stolen Key 1) tries to invite Dave
    const daveAdd = createAddOp('https://bob.site', 'https://dave.site', 'dave', allOpIds(state), bobKeysOld.privateKey)
    
    // Transport layer accepts it because it's signed by a historically known key
    const filteredOps = filterValidOps([daveAdd], state, 'https://bob.site', true)
    assert.equal(filteredOps.length, 1, 'Transport layer should accept the historically valid signature')
    state.set(daveAdd.id, daveAdd)

    const view = deriveView(state)

    // Causal signature verification should reject Dave because the active key has rotated
    assert.equal(view.members.find(m => m.url === 'https://dave.site'), undefined, 'Dave should be rejected due to obsolete key')
  })
})
