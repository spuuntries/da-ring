import { defineCommand, runMain } from 'citty'

const main = defineCommand({
  meta: { name: 'da-ring', description: 'Decentralized webring CLI' },
  subCommands: {
    init: () => import('./commands/init.js').then(m => m.default),
    invite: () => import('./commands/invite.js').then(m => m.default),
    revoke: () => import('./commands/revoke.js').then(m => m.default),
    leave: () => import('./commands/leave.js').then(m => m.default),
    upgrade: () => import('./commands/upgrade.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default)
  }
})

runMain(main)
