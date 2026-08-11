import { defineCommand } from 'citty'
import { createRevokeOp, allOpIds } from '../../crdt/index.js'
import { loadKeys, loadState, saveState } from '../config.js'

export default defineCommand({
  meta: { name: 'revoke', description: 'Revoke a member from the webring' },
  args: {
    url: { type: 'positional', description: 'URL to revoke', required: true }
  },
  run: async ({ args }) => {
    const keys = loadKeys()
    if (!keys) throw new Error('No local keys found')

    const state = loadState()
    const seenIds = allOpIds(state)
    
    const op = createRevokeOp(
      keys.url,
      args.url,
      seenIds,
      keys.privateKey
    )

    state.set(op.id, op)
    saveState(state)
    
    console.log(`Revoked ${args.url} from the webring`)
  }
})
