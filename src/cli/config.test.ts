import test from 'node:test'
import assert from 'node:assert'
import { syncWithPeers } from './config.js'
import { createGenesisOp, createAddOp, createKeyClaimOp, allOpIds, deriveView } from '../crdt/index.js'
import { generateKeypair } from '../crypto/keys.js'

test('syncWithPeers polls all members, not just active ones', async () => {
  const aliceKeys = generateKeypair()
  const bobKeys = generateKeypair()
  const daveKeys = generateKeypair()

  // Create a base state: Genesis (Alice) -> Invites Bob -> Bob upgrades -> Bob invites Dave
  const aliceGenesis = createGenesisOp('https://alice.site', 'test ring', 2, aliceKeys.privateKey)
  let state = new Map()
  state.set(aliceGenesis.id, aliceGenesis)
  
  const aliceClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, allOpIds(state), aliceKeys.privateKey)
  state.set(aliceClaim.id, aliceClaim)

  const bobAdd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(state), aliceKeys.privateKey)
  state.set(bobAdd.id, bobAdd)

  const bobClaim = createKeyClaimOp('https://bob.site', bobKeys.publicKey, allOpIds(state), bobKeys.privateKey)
  state.set(bobClaim.id, bobClaim)

  const daveAdd = createAddOp('https://bob.site', 'https://dave.site', 'dave', allOpIds(state), bobKeys.privateKey)
  state.set(daveAdd.id, daveAdd)

  // Verify Dave is currently passive
  const view = deriveView(state)
  assert.equal(view.members.length, 3, 'should have 3 members')
  assert.equal(view.activeMembers.length, 2, 'should have 2 active members (Alice, Bob)')
  assert.equal(view.activeMembers.includes('https://dave.site'), false, 'Dave is passive')

  // Mock Dave's upgrade op (which he has locally but Alice doesn't know about)
  const daveClaim = createKeyClaimOp('https://dave.site', daveKeys.publicKey, allOpIds(state), daveKeys.privateKey)
  const daveState = new Map(state)
  daveState.set(daveClaim.id, daveClaim)
  
  // Mock fetch
  const originalFetch = global.fetch
  let fetchedUrls: string[] = []
  
  global.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
    const urlStr = url.toString()
    fetchedUrls.push(urlStr)
    
    if (urlStr === 'https://dave.site/webring.json') {
      // Dave upgraded, return his state
      return {
        ok: true,
        json: async () => Array.from(daveState.values())
      } as Response
    }
    
    // Simulate others being unreachable or not having new ops
    return {
      ok: true,
      json: async () => Array.from(state.values())
    } as Response
  }

  try {
    const syncedState = await syncWithPeers(state)
    const syncedView = deriveView(syncedState)
    
    assert.equal(fetchedUrls.includes('https://dave.site/webring.json'), true, 'should have fetched from passive Dave')
    assert.equal(syncedView.activeMembers.length, 3, 'Dave should now be active')
    assert.equal(syncedView.activeMembers.includes('https://dave.site'), true)
  } finally {
    global.fetch = originalFetch
  }
})
