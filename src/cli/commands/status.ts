import { defineCommand } from 'citty'
import { loadState, loadKeys } from '../config.js'
import { deriveView } from '../../crdt/index.js'

export default defineCommand({
  meta: { name: 'status', description: 'Show webring status and invite tree' },
  run: async () => {
    const state = await loadState()
    if (state.size === 0) {
      console.log('\x1b[33m⚠\x1b[0m no ring found. run \x1b[36mda-ring init\x1b[0m first')
      return
    }

    const view = deriveView(state)
    const keys = loadKeys()

    console.log(`\x1b[36m✦ ${view.name}\x1b[0m (${view.members.length} member${view.members.length !== 1 ? 's' : ''})`)
    console.log()

    if (keys) {
      const mySlots = view.inviteSlots.get(keys.url) ?? 0
      console.log(`  you: \x1b[33m${keys.url}\x1b[0m (${mySlots}/${view.inviteBudget} invite slots)`)
      console.log()
    }

    // Print invite tree
    function printTree(url: string, prefix: string, isLast: boolean, isRoot: boolean) {
      const member = view.members.find(m => m.url === url)
      if (!member) return

      const slots = view.inviteSlots.get(url) ?? 0
      const statusTag = member.isActive ? '\x1b[32mactive\x1b[0m' : '\x1b[90mpassive\x1b[0m'
      const genesisTag = member.invitedBy === null ? '\x1b[35mgenesis\x1b[0m, ' : ''
      const slotsStr = member.isActive ? ` [\x1b[33m${slots}/${view.inviteBudget}\x1b[0m]` : ''
      const isMe = keys && keys.url === url

      const connector = isRoot ? '' : (isLast ? '└── ' : '├── ')
      const nameStr = member.name === url ? '' : (isMe ? ` \x1b[1m${member.name}\x1b[0m` : ` ${member.name}`)

      console.log(`${prefix}${connector}${url}${nameStr} (${genesisTag}${statusTag})${slotsStr}`)

      const children = (view.inviteTree.get(url) ?? []).filter(childUrl => view.members.some(m => m.url === childUrl))
      const childPrefix = prefix + (isRoot ? '' : (isLast ? '    ' : '│   '))

      children.forEach((childUrl: string, index: number) => {
        printTree(childUrl, childPrefix, index === children.length - 1, false)
      })
    }

    if (view.genesis) {
      printTree(view.genesis.author, '  ', true, true)
    } else {
      console.log('  \x1b[31mno genesis op found\x1b[0m')
    }
  },
})
