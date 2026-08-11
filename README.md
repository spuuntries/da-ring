<p align="center">
  <img src="logo.png" alt="da-ring" width="250" style="margin: -5em" />
</p>

<h1 align="center">da-ring</h1>

<p align="center">
  <em>a decentralized webring with no central server</em><br/>
  <sub>membership via CRDT · browser-side gossip · invite tree governance</sub>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-a78bfa" />
  <img alt="node" src="https://img.shields.io/badge/node-18+-8b5cf6" />
  <img alt="bundle" src="https://img.shields.io/badge/widget-23KB-c4b5fd" />
</p>

---

**fork this repo to create your own ring.**

## why

traditional webrings have a central server that manages the member list. if that server goes down or the maintainer walks away, the ring dies. and someone has to babysit it.

da-ring flips this — every member's website _is_ a node. the member list is a CRDT that converges through normal HTTP fetches. no server to maintain, no single point of failure, no one person who has to keep things running.

the invite tree means governance is baked into the data structure itself. no need for voting systems or admin panels — if you invited someone and they turn out to be a problem, you revoke them and their entire subtree goes with them. simple, deterministic, no drama infrastructure.

it's designed for friend groups who want a webring without anyone having to be "the webring person."

## how it works

each ring member's site hosts a `webring.json` file — a set of signed operations (adds, revokes, leaves). the webring widget fetches from multiple members and merges everything client-side. no central server — your website _is_ your node.

membership is governed by an **invite tree**: every member has an inviter, the tree is the authority structure.

### ✦ two tiers

|                 | passive                | active                   |
| --------------- | ---------------------- | ------------------------ |
| **setup**       | paste a `<script>` tag | also host `webring.json` |
| **can invite?** | no                     | yes                      |
| **redundancy**  | reads from actives     | serves state to others   |

most friends just need to be passive. the genesis member (you) is always active.

## quick start

### 1. fork & configure

fork [`spuuntries/da-ring`](https://github.com/spuuntries/da-ring) on github, then:

```bash
# ↓ change this to your fork's URL after forking
git clone https://github.com/your-username/da-ring
cd da-ring
npm install
```

edit [`ring.config.ts`](ring.config.ts):

```typescript
export default {
  name: "frens webring",
  inviteBudget: 2, // invites per member
};
```

### 2. initialize your ring

```bash
npx da-ring init --url https://your.site
```

this generates:

- **`webring.json`** — deploy to your site root
- **`.da-ring/keys.json`** — your keypair _(gitignored, keep safe!)_

also add the widget to your own site:

```html
<script
  src="https://your.site/widget.js"
  data-ring="https://your.site"
></script>
```

> host the built `dist/index.widget.js` on your site or a CDN. here it's been renamed as `widget.js` for simplicity, but you can rename the file into whatever, just change it in the `src` field when you're embedding the widget.

### 3. invite friends

```bash
npx da-ring invite https://friend.site --name "friend"
```

re-deploy your updated `webring.json`, then tell your friend to paste the widget:

```html
<script
  src="https://your.site/widget.js"
  data-ring="https://your.site"
></script>
```

### 4. build (only after edits)

`npm install` auto-builds everything. you only need to rebuild manually if you change the widget styles or ring config:

```bash
npm run build
```

outputs `dist/index.widget.js` — self-contained widget bundle (~23KB).

### 5. upgrading (passive → active)

a passive member who wants to start inviting people:

```bash
# clone the ring owner's fork (not the upstream template)
git clone https://github.com/ring-owner/da-ring
cd da-ring && npm install

# upgrade — pulls state from an active member, generates your keypair
npx da-ring upgrade --ring https://alice.site --url https://your.site
```

this generates their own `webring.json` + keypair. deploy both `webring.json` and the widget to your site:

```html
<!-- add this to your site too -->
<script
  src="https://your.site/widget.js"
  data-ring="https://alice.site,https://your.site"
></script>
```

now you're active — can invite others and contribute to ring redundancy. note the `data-ring` lists multiple bootstrap URLs for better resilience.

## cli

all commands: `npx da-ring <command>`

| command                                  | description                                      |
| :--------------------------------------- | :----------------------------------------------- |
| **`init`** `--url <url>`                 | initialize a new ring                            |
| **`invite`** `<url> --name <name>`       | invite someone                                   |
| **`revoke`** `<url>`                     | revoke a member _(cascades to their invitees)_   |
| **`leave`**                              | leave the ring _(your invitees get re-parented)_ |
| **`upgrade`** `--ring <url> --url <url>` | passive → active                                 |
| **`sync`**                               | pull state from active peers                     |
| **`status`**                             | show ring info and invite tree                   |

**`status` output:**

```
✦ frens ring (3 members)

  you: https://alice.site (0/2 invite slots)

  https://alice.site (genesis, active) [0/2]
  ├── https://bob.site bob (passive)
  └── https://carol.site carol (passive)
```

## the crdt

the ring state is a **grow-only set of signed operations** (G-Set).

```
merge(a, b) = a ∪ b    // set union — commutative, associative, idempotent
```

each operation is signed with Ed25519 and includes causal dependencies (`seen` op IDs). everyone with the same ops derives the same member list by replaying in causal order.

### operations

| op            | what it does                           | signed by |
| :------------ | :------------------------------------- | :-------- |
| **genesis**   | creates the ring, sets name + budget   | founder   |
| **add**       | invites a new member                   | inviter   |
| **key-claim** | publishes pubkey (passive → active)    | self      |
| **revoke**    | removes invitee + cascades subtree     | inviter   |
| **leave**     | exits, children re-parented to inviter | self      |

### conflict resolution

- revoke wins over concurrent add for same target
- invite budget enforced at derivation time
- only direct inviters can revoke their invitees
- deterministic ring order via `SHA-256(member URL)`

## governance

the invite tree _is_ the governance:

```
alice (genesis)
├── bob
│   └── carol ← bob can revoke
└── dave     ← alice can revoke
```

- **revoke** cascades: revoking bob also removes carol
- **leave** re-parents: if bob leaves, carol moves under alice
- no voting, no quorum — the tree is the authority

## customizing

edit the styles in [`src/widget/render.ts`](src/widget/render.ts) and rebuild. the widget uses shadow DOM so nothing leaks.

```bash
npm run build
```

## architecture

```
src/
├── crdt/           # CRDT engine (isomorphic)
│   ├── ops.ts      # operation types + signing
│   ├── state.ts    # G-Set merge + view derivation
│   └── validate.ts # signature + rule validation
├── crypto/
│   └── keys.ts     # Ed25519 + SHA-256
├── cli/            # CLI commands
│   ├── config.ts   # local state management
│   └── commands/   # init, invite, revoke, leave, upgrade, sync, status
└── widget/         # browser widget (23KB bundle)
    ├── index.ts    # fetch + merge + orchestrate
    └── render.ts   # shadow DOM rendering + styles
```

## license

MIT
