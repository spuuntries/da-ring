import { defineCommand } from 'citty'
import { createLeaveOp, allOpIds } from '../../crdt/index.js'
import { loadKeys, loadState, saveState, syncWithPeers } from '../config.js'

export default defineCommand({
  meta: { name: 'leave', description: 'Leave the webring' },
  run: async () => {
    const keys = loadKeys()
    if (!keys) throw new Error('No local keys found')

    let state = await loadState()
    const seenIds = allOpIds(state)
    
    const op = createLeaveOp(
      keys.url,
      seenIds,
      keys.privateKey
    )

    state.set(op.id, op)
    state = await syncWithPeers(state)
    await saveState(state)
    
    console.log(`Left the webring`)
  }
})
