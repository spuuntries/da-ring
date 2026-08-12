import { defineCommand } from 'citty'
import { generateKeypair } from '../../crypto/keys.js'
import { createGenesisOp, createKeyClaimOp, fromOps, allOpIds, slugify } from '../../crdt/index.js'
import { saveKeys, saveState, loadRingConfig } from '../config.js'

export default defineCommand({
  meta: { name: 'init', description: 'Initialize a new webring' },
  args: {
    url: { type: 'string', description: 'Your site URL (e.g. https://my.site)', required: true },
    name: { type: 'string', description: 'Ring name (overrides ring.config.ts)' },
    budget: { type: 'string', description: 'Invite budget per member (overrides ring.config.ts)' },
  },
  run: async ({ args }) => {
    args.url = args.url.trim()
    const config = await loadRingConfig()
    const ringName = args.name || config.name
    const budget = args.budget ? parseInt(args.budget) : config.inviteBudget

    const { publicKey, privateKey } = generateKeypair()

    // Create genesis op
    const genesis = createGenesisOp(args.url, ringName, budget, privateKey)

    // Immediately claim our key so we're an active member
    const keyClaim = createKeyClaimOp(args.url, publicKey, [genesis.id], privateKey)

    const state = fromOps([genesis, keyClaim])

    saveKeys({ publicKey, privateKey, url: args.url })
    await saveState(state)

    console.log(`\x1b[32m✓\x1b[0m initialized ring "\x1b[36m${ringName}\x1b[0m"`)
    console.log(`  url: ${args.url}`)
    console.log(`  budget: ${budget} invites per member`)
    console.log()
    console.log(`  deploy \x1b[33m${slugify(ringName)}.json\x1b[0m to your site root`)
    console.log()
    console.log(`  friends can join with:`)
    console.log(`  \x1b[90m<script src="https://your-cdn/widget.js" data-ring="${args.url}" data-ring-name="${ringName}"></script>\x1b[0m`)
  },
})
