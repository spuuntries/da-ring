import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeypair, sign, verify, hash } from '../crypto/keys.js'
import {
  createGenesisOp, createAddOp, createKeyClaimOp,
  createRevokeOp, createLeaveOp,
} from '../crdt/ops.js'
import {
  createState, fromOps, merge, serialize, deserialize,
  allOpIds, deriveView, deriveRingOrder, getNeighbors,
} from '../crdt/state.js'
import type { RingState, Member } from '../crdt/state.js'

// ── Helpers ──────────────────────────────────────────────────────

function setupGenesis() {
  const keys = generateKeypair()
  const url = 'https://alice.site'
  const genesis = createGenesisOp(url, 'test ring', 2, keys.privateKey)
  const keyClaim = createKeyClaimOp(url, keys.publicKey, [genesis.id], keys.privateKey)
  const state = fromOps([genesis, keyClaim])
  return { keys, url, genesis, keyClaim, state }
}

function addMember(
  state: RingState,
  inviterUrl: string,
  inviterPrivateKey: string,
  targetUrl: string,
  targetName: string,
) {
  const seenIds = allOpIds(state)
  const addOp = createAddOp(inviterUrl, targetUrl, targetName, seenIds, inviterPrivateKey)
  state.set(addOp.id, addOp)
  return addOp
}

// ── Crypto Tests ─────────────────────────────────────────────────

describe('crypto', () => {
  it('generates valid keypairs', () => {
    const kp = generateKeypair()
    assert.ok(kp.publicKey.length === 64, 'pubkey should be 32 bytes hex')
    assert.ok(kp.privateKey.length === 64, 'privkey should be 32 bytes hex')
  })

  it('signs and verifies messages', () => {
    const kp = generateKeypair()
    const msg = 'hello world'
    const sig = sign(msg, kp.privateKey)
    assert.ok(verify(msg, sig, kp.publicKey))
  })

  it('rejects invalid signatures', () => {
    const kp1 = generateKeypair()
    const kp2 = generateKeypair()
    const msg = 'hello world'
    const sig = sign(msg, kp1.privateKey)
    assert.ok(!verify(msg, sig, kp2.publicKey))
  })

  it('rejects tampered messages', () => {
    const kp = generateKeypair()
    const sig = sign('hello', kp.privateKey)
    assert.ok(!verify('tampered', sig, kp.publicKey))
  })

  it('produces deterministic hashes', () => {
    assert.equal(hash('test'), hash('test'))
    assert.notEqual(hash('a'), hash('b'))
  })
})

// ── CRDT Merge Tests ─────────────────────────────────────────────

describe('crdt merge', () => {
  it('merge is commutative (a∪b = b∪a)', () => {
    const { state: stateA } = setupGenesis()
    const keysB = generateKeypair()
    const genesis2 = createGenesisOp('https://bob.site', 'ring b', 2, keysB.privateKey)
    const stateB = fromOps([genesis2])

    const ab = serialize(merge(stateA, stateB))
    const ba = serialize(merge(stateB, stateA))
    assert.deepEqual(ab, ba)
  })

  it('merge is idempotent (a∪a = a)', () => {
    const { state } = setupGenesis()
    const merged = merge(state, state)
    assert.equal(merged.size, state.size)
    assert.deepEqual(serialize(merged), serialize(state))
  })

  it('merge is associative ((a∪b)∪c = a∪(b∪c))', () => {
    const k1 = generateKeypair()
    const k2 = generateKeypair()
    const k3 = generateKeypair()
    const a = fromOps([createGenesisOp('https://a.site', 'a', 2, k1.privateKey)])
    const b = fromOps([createGenesisOp('https://b.site', 'b', 2, k2.privateKey)])
    const c = fromOps([createGenesisOp('https://c.site', 'c', 2, k3.privateKey)])

    const ab_c = serialize(merge(merge(a, b), c))
    const a_bc = serialize(merge(a, merge(b, c)))
    assert.deepEqual(ab_c, a_bc)
  })

  it('serialization round-trips', () => {
    const { state } = setupGenesis()
    const ops = serialize(state)
    const restored = deserialize(ops)
    assert.deepEqual(serialize(restored), ops)
  })
})

// ── View Derivation Tests ────────────────────────────────────────

describe('derive view', () => {
  it('genesis creates one member', () => {
    const { state, url } = setupGenesis()
    const view = deriveView(state)
    assert.equal(view.name, 'test ring')
    assert.equal(view.inviteBudget, 2)
    assert.equal(view.members.length, 1)
    assert.equal(view.members[0].url, url)
    assert.equal(view.members[0].isActive, true)
    assert.equal(view.members[0].invitedBy, null)
  })

  it('adding a member increases count', () => {
    const { state, url, keys } = setupGenesis()
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')
    const view = deriveView(state)
    assert.equal(view.members.length, 2)
    const bob = view.members.find(m => m.url === 'https://bob.site')
    assert.ok(bob)
    assert.equal(bob.name, 'bob')
    assert.equal(bob.invitedBy, url)
    assert.equal(bob.isActive, false) // no key-claim yet
  })

  it('enforces invite budget', () => {
    const { state, url, keys } = setupGenesis()
    // Budget is 2 — add 2 members, then try a 3rd
    addMember(state, url, keys.privateKey, 'https://b.site', 'b')
    addMember(state, url, keys.privateKey, 'https://c.site', 'c')
    addMember(state, url, keys.privateKey, 'https://d.site', 'd') // should be ignored

    const view = deriveView(state)
    assert.equal(view.members.length, 3) // genesis + 2, not 4
    assert.ok(!view.members.find(m => m.url === 'https://d.site'))
  })

  it('revocation cascades through subtree', () => {
    const { state, url, keys } = setupGenesis()

    // alice → bob → carol
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')

    const bobKeys = generateKeypair()
    const bobKeyClaim = createKeyClaimOp(
      'https://bob.site', bobKeys.publicKey,
      allOpIds(state), bobKeys.privateKey,
    )
    state.set(bobKeyClaim.id, bobKeyClaim)

    addMember(state, 'https://bob.site', bobKeys.privateKey, 'https://carol.site', 'carol')

    // Verify all 3 are in
    let view = deriveView(state)
    assert.equal(view.members.length, 3)

    // Alice revokes bob — should cascade to carol
    const revokeOp = createRevokeOp(url, 'https://bob.site', allOpIds(state), keys.privateKey, false)
    state.set(revokeOp.id, revokeOp)

    view = deriveView(state)
    assert.equal(view.members.length, 1) // only alice left
    assert.equal(view.members[0].url, url)
  })

  it('soft-revoke re-parents children to the inviter', () => {
    const { state, url, keys } = setupGenesis()

    // alice → bob → carol
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')

    const bobKeys = generateKeypair()
    const bobKeyClaim = createKeyClaimOp(
      'https://bob.site', bobKeys.publicKey,
      allOpIds(state), bobKeys.privateKey,
    )
    state.set(bobKeyClaim.id, bobKeyClaim)

    addMember(state, 'https://bob.site', bobKeys.privateKey, 'https://carol.site', 'carol')

    // Alice SOFT-revokes bob — carol should be re-parented to alice
    const revokeOp = createRevokeOp(url, 'https://bob.site', allOpIds(state), keys.privateKey, true)
    state.set(revokeOp.id, revokeOp)

    const view = deriveView(state)
    assert.equal(view.members.length, 2) // alice, carol
    const carol = view.members.find(m => m.url === 'https://carol.site')
    assert.ok(carol)
    assert.equal(carol.invitedBy, url) // re-parented to alice
  })

  it('voluntary leave re-parents children', () => {
    const { state, url, keys } = setupGenesis()

    // alice → bob → carol
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')

    const bobKeys = generateKeypair()
    const bobKeyClaim = createKeyClaimOp(
      'https://bob.site', bobKeys.publicKey,
      allOpIds(state), bobKeys.privateKey,
    )
    state.set(bobKeyClaim.id, bobKeyClaim)

    addMember(state, 'https://bob.site', bobKeys.privateKey, 'https://carol.site', 'carol')

    // Bob leaves — carol should be re-parented to alice
    const leaveOp = createLeaveOp('https://bob.site', allOpIds(state), bobKeys.privateKey)
    state.set(leaveOp.id, leaveOp)

    const view = deriveView(state)
    assert.equal(view.members.length, 2) // alice + carol
    const carol = view.members.find(m => m.url === 'https://carol.site')
    assert.ok(carol)
    assert.equal(carol.invitedBy, url) // re-parented to alice
  })

  it('revoke gives back invite slot', () => {
    const { state, url, keys } = setupGenesis()

    addMember(state, url, keys.privateKey, 'https://b.site', 'b')
    addMember(state, url, keys.privateKey, 'https://c.site', 'c')

    // Budget is 2, both slots used
    let view = deriveView(state)
    assert.equal(view.inviteSlots.get(url), 0)

    // Revoke one — should free a slot
    const revokeOp = createRevokeOp(url, 'https://b.site', allOpIds(state), keys.privateKey)
    state.set(revokeOp.id, revokeOp)

    view = deriveView(state)
    assert.equal(view.inviteSlots.get(url), 1)
  })

  it('key-claim makes member active', () => {
    const { state, url, keys } = setupGenesis()
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')

    let view = deriveView(state)
    assert.ok(!view.members.find(m => m.url === 'https://bob.site')!.isActive)
    assert.ok(!view.activeMembers.includes('https://bob.site'))

    // Bob claims a key
    const bobKeys = generateKeypair()
    const keyClaim = createKeyClaimOp(
      'https://bob.site', bobKeys.publicKey,
      allOpIds(state), bobKeys.privateKey,
    )
    state.set(keyClaim.id, keyClaim)

    view = deriveView(state)
    assert.ok(view.members.find(m => m.url === 'https://bob.site')!.isActive)
    assert.ok(view.activeMembers.includes('https://bob.site'))
  })

  it('allows re-adding a revoked member and clears revoked status', () => {
    const { state, url, keys } = setupGenesis()
    
    // Alice adds Bob
    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')
    
    // Alice revokes Bob
    const revokeOp = createRevokeOp(url, 'https://bob.site', allOpIds(state), keys.privateKey)
    state.set(revokeOp.id, revokeOp)

    let view = deriveView(state)
    assert.equal(view.members.length, 1)
    
    // Alice adds Carol
    addMember(state, url, keys.privateKey, 'https://carol.site', 'carol')
    const carolKeys = generateKeypair()
    const carolKeyClaim = createKeyClaimOp('https://carol.site', carolKeys.publicKey, allOpIds(state), carolKeys.privateKey)
    state.set(carolKeyClaim.id, carolKeyClaim)

    // Carol re-adds Bob
    addMember(state, 'https://carol.site', carolKeys.privateKey, 'https://bob.site', 'bob2')

    view = deriveView(state)
    assert.equal(view.members.length, 3) // alice, carol, bob

    const bob = view.members.find(m => m.url === 'https://bob.site')
    assert.ok(bob)
    assert.equal(bob.invitedBy, 'https://carol.site') // Carol is the new inviter
    
    // Alice's invite tree should NOT have Bob anymore
    assert.deepEqual(view.inviteTree.get(url) ?? [], ['https://carol.site'])
    
    // Carol's invite tree SHOULD have Bob
    assert.deepEqual(view.inviteTree.get('https://carol.site') ?? [], ['https://bob.site'])

    // Carol should be able to revoke Bob again (proving Bob is not immune)
    const revoke2 = createRevokeOp('https://carol.site', 'https://bob.site', allOpIds(state), carolKeys.privateKey)
    state.set(revoke2.id, revoke2)

    view = deriveView(state)
    assert.equal(view.members.length, 2) // alice, carol
  })
})

// ── Ring Order Tests ─────────────────────────────────────────────

describe('ring order', () => {
  it('order is deterministic', () => {
    const members: Member[] = [
      { url: 'https://c.site', name: 'c', invitedBy: null, pubkey: null, isActive: false, depth: 0 },
      { url: 'https://a.site', name: 'a', invitedBy: null, pubkey: null, isActive: false, depth: 0 },
      { url: 'https://b.site', name: 'b', invitedBy: null, pubkey: null, isActive: false, depth: 0 },
    ]
    const order1 = deriveRingOrder(members).map(m => m.url)
    const order2 = deriveRingOrder([...members].reverse()).map(m => m.url)
    assert.deepEqual(order1, order2)
  })

  it('getNeighbors wraps around', () => {
    const members: Member[] = ['a', 'b', 'c'].map(name => ({
      url: `https://${name}.site`, name, invitedBy: null, pubkey: null, isActive: false, depth: 0,
    }))
    const ordered = deriveRingOrder(members)
    const first = ordered[0].url
    const last = ordered[ordered.length - 1].url

    const { prev, next } = getNeighbors(ordered, first)
    assert.equal(prev!.url, last) // wraps to end
    assert.equal(next!.url, ordered[1].url)
  })
})

// ── Conflict Resolution Tests ────────────────────────────────────

describe('conflict resolution', () => {
  it('duplicate adds are idempotent', () => {
    const { state, url, keys } = setupGenesis()
    const seenIds = allOpIds(state)

    // Two add ops for the same target (simulating concurrent adds)
    const add1 = createAddOp(url, 'https://bob.site', 'bob', seenIds, keys.privateKey)
    const add2 = createAddOp(url, 'https://bob.site', 'bob2', seenIds, keys.privateKey)
    state.set(add1.id, add1)
    state.set(add2.id, add2)

    const view = deriveView(state)
    // Should only appear once (first add wins)
    const bobs = view.members.filter(m => m.url === 'https://bob.site')
    assert.equal(bobs.length, 1)
  })

  it('only direct inviter can revoke', () => {
    const { state, url, keys } = setupGenesis()

    addMember(state, url, keys.privateKey, 'https://bob.site', 'bob')

    const bobKeys = generateKeypair()
    const bobKeyClaim = createKeyClaimOp(
      'https://bob.site', bobKeys.publicKey,
      allOpIds(state), bobKeys.privateKey,
    )
    state.set(bobKeyClaim.id, bobKeyClaim)

    addMember(state, 'https://bob.site', bobKeys.privateKey, 'https://carol.site', 'carol')

    // Alice tries to revoke carol (but bob is carol's inviter, not alice)
    const badRevoke = createRevokeOp(url, 'https://carol.site', allOpIds(state), keys.privateKey)
    state.set(badRevoke.id, badRevoke)

    const view = deriveView(state)
    // Carol should still be in the ring
    assert.ok(view.members.find(m => m.url === 'https://carol.site'))
  })
})
