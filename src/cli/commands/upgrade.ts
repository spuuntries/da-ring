import { defineCommand } from 'citty'
import { generateKeypair } from '../../crypto/keys.js'
import { createKeyClaimOp, allOpIds } from '../../crdt/index.js'
import { fetchRemoteState, loadState, saveKeys, saveState, syncWithPeers } from '../config.js'
import { filterValidOps, fromOps } from '../../crdt/index.js'

export default defineCommand({
  meta: { name: 'upgrade', description: 'Upgrade an invite to a full membership' },
  args: {
    ring: { type: 'string', description: 'URL of a ring member to bootstrap from', required: true },
    url: { type: 'string', description: 'Your own URL', required: true }
  },
  run: async ({ args }) => {
    args.ring = args.ring.trim()
    args.url = args.url.trim()
    const remoteOps = await fetchRemoteState(args.ring)
    let state = fromOps(filterValidOps(remoteOps, new Map(), args.ring, true))
    
    
    const { publicKey, privateKey } = generateKeypair()
    const seenIds = allOpIds(state)
    
    const op = createKeyClaimOp(
      args.url,
      publicKey,
      seenIds,
      privateKey
    )

    state.set(op.id, op)
    state = await syncWithPeers(state)
    
    saveKeys({ publicKey, privateKey, url: args.url })
    await saveState(state)
    
    console.log(`Upgraded to full membership at ${args.url}`)
  }
})
