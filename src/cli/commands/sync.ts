import { defineCommand } from 'citty'
import { loadState, saveState, syncWithPeers, loadRingConfig } from '../config.js'

export default defineCommand({
  meta: { name: 'sync', description: 'Sync webring state with peers' },
  run: async () => {
    const config = await loadRingConfig()
    const state = await loadState()
    const syncedState = await syncWithPeers(state, config.name)
    await saveState(syncedState)
    console.log('Synced state with peers')
  }
})
