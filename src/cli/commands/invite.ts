import { defineCommand } from 'citty'
import { createAddOp, allOpIds } from '../../crdt/index.js'
import { loadKeys, loadState, saveState, syncWithPeers } from '../config.js'

export default defineCommand({
  meta: { name: 'invite', description: 'Invite a member to the webring' },
  args: {
    url: { type: 'positional', description: 'URL to invite', required: true },
    name: { type: 'string', description: 'Name of the member' }
  },
  run: async ({ args }) => {
    const keys = loadKeys()
    if (!keys) throw new Error('No local keys found')

    let state = loadState()
    const seenIds = allOpIds(state)
    
    const op = createAddOp(
      keys.url,
      args.url,
      args.name || args.url,
      seenIds,
      keys.privateKey
    )

    state.set(op.id, op)
    state = await syncWithPeers(state)
    saveState(state)
    
    console.log(`Invited ${args.url} to the webring`)
  }
})
