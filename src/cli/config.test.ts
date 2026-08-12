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
    
    if (urlStr === 'https://dave.site/test-ring.json') {
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
    const syncedState = await syncWithPeers(state, 'test ring')
    const syncedView = deriveView(syncedState)
    
    assert.equal(fetchedUrls.includes('https://dave.site/test-ring.json'), true, 'should have fetched from passive Dave')
    assert.equal(syncedView.activeMembers.length, 3, 'Dave should now be active')
    assert.equal(syncedView.activeMembers.includes('https://dave.site'), true)
  } finally {
    global.fetch = originalFetch
  }
})

test('syncWithPeers dynamically discovers members across multiple hops', async () => {
  const aliceKeys = generateKeypair()
  const bobKeys = generateKeypair()
  const charlieKeys = generateKeypair()

  // Alice only knows about Bob initially
  const aliceGenesis = createGenesisOp('https://alice.site', 'test ring', 2, aliceKeys.privateKey)
  let aliceState = new Map()
  aliceState.set(aliceGenesis.id, aliceGenesis)
  
  const aliceClaim = createKeyClaimOp('https://alice.site', aliceKeys.publicKey, allOpIds(aliceState), aliceKeys.privateKey)
  aliceState.set(aliceClaim.id, aliceClaim)

  const bobAdd = createAddOp('https://alice.site', 'https://bob.site', 'bob', allOpIds(aliceState), aliceKeys.privateKey)
  aliceState.set(bobAdd.id, bobAdd)

  // Bob's state knows about Bob claiming key, and Bob adding Charlie
  const bobState = new Map(aliceState)
  const bobClaim = createKeyClaimOp('https://bob.site', bobKeys.publicKey, allOpIds(bobState), bobKeys.privateKey)
  bobState.set(bobClaim.id, bobClaim)

  const charlieAdd = createAddOp('https://bob.site', 'https://charlie.site', 'charlie', allOpIds(bobState), bobKeys.privateKey)
  bobState.set(charlieAdd.id, charlieAdd)

  // Charlie's state knows about Charlie claiming key
  const charlieState = new Map(bobState)
  const charlieClaim = createKeyClaimOp('https://charlie.site', charlieKeys.publicKey, allOpIds(charlieState), charlieKeys.privateKey)
  charlieState.set(charlieClaim.id, charlieClaim)

  const originalFetch = global.fetch
  let fetchedUrls: string[] = []

  global.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
    const urlStr = url.toString()
    fetchedUrls.push(urlStr)

    if (urlStr === 'https://bob.site/test-ring.json') {
      return { ok: true, json: async () => Array.from(bobState.values()) } as Response
    }
    if (urlStr === 'https://charlie.site/test-ring.json') {
      return { ok: true, json: async () => Array.from(charlieState.values()) } as Response
    }
    return { ok: false } as Response
  }

  try {
    const syncedState = await syncWithPeers(aliceState, 'test ring')
    const syncedView = deriveView(syncedState)

    // Should fetch bob, discover charlie from bob's state, and then fetch charlie in the next loop
    assert.equal(fetchedUrls.includes('https://bob.site/test-ring.json'), true, 'fetched bob')
    assert.equal(fetchedUrls.includes('https://charlie.site/test-ring.json'), true, 'dynamically fetched charlie')
    
    assert.equal(syncedView.activeMembers.length, 3, 'all 3 should be active')
    assert.equal(syncedView.activeMembers.includes('https://charlie.site'), true)
  } finally {
    global.fetch = originalFetch
  }
})

test('fetchRemoteState aborts after timeout', async () => {
  const originalFetch = global.fetch
  
  // Mock fetch to never resolve
  global.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
    return new Promise((resolve, reject) => {
      // Listen for the abort signal and reject immediately when triggered
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          reject(new Error('AbortError: The operation was aborted'))
        })
      }
    })
  }

  try {
    const { fetchRemoteState } = await import('./config.js')
    
    // We expect this to reject after ~3000ms, but we don't want to wait 3 seconds in the test suite.
    // However, since it's just a setTimeout in config.ts, node's test runner will actually wait 3s.
    // For a real robust test we'd mock timers, but for this simple webring this is fine.
    await assert.rejects(
      fetchRemoteState('https://slow-node.site', 'test ring'),
      (err: Error) => err.message.includes('AbortError')
    )
  } finally {
    global.fetch = originalFetch
  }
})
