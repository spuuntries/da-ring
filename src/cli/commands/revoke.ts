import { defineCommand } from 'citty'
import { createRevokeOp, allOpIds } from '../../crdt/index.js'
import { loadKeys, loadState, saveState, syncWithPeers } from '../config.js'

export default defineCommand({
  meta: { name: 'revoke', description: 'Revoke a member from the webring' },
  args: {
    url: { type: 'positional', description: 'URL to revoke', required: true },
    soft: { type: 'boolean', description: 'Soft-revoke (re-parent children instead of cascading)', required: false }
  },
  run: async ({ args }) => {
    args.url = args.url.trim()
    const keys = loadKeys()
    if (!keys) throw new Error('No local keys found')

    let state = await loadState()
    const seenIds = allOpIds(state)
    
    const op = createRevokeOp(
      keys.url,
      args.url,
      seenIds,
      keys.privateKey,
      args.soft
    )

    state.set(op.id, op)
    state = await syncWithPeers(state)
    await saveState(state)
    
    console.log(`${args.soft ? 'Soft-revoked' : 'Revoked'} ${args.url} from the webring`)
  }
})
