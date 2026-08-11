import { defineCommand } from 'citty'
import { loadState, saveState, syncWithPeers } from '../config.js'

export default defineCommand({
  meta: { name: 'sync', description: 'Sync webring state with peers' },
  run: async () => {
    const state = loadState()
    const syncedState = await syncWithPeers(state)
    saveState(syncedState)
    console.log('Synced state with peers')
  }
})
