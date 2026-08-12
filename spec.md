# da-ring Specification

da-ring is a decentralized, serverless webring protocol where membership is managed via a Conflict-Free Replicated Data Type (CRDT). Instead of a central server, each active member's website acts as a node, hosting a fraction of the webring state.

The webring forms an **invite tree**. The network converges on a unified member list through client-side gossip and merging, allowing the ring to exist entirely through static file hosting and browser fetches.

## 1. The State (CRDT)

The ring state is represented as a **Grow-Only Set (G-Set)** of signed operations. 

- **Commutativity, Associativity, Idempotency**: State merging is a simple set union (`merge(a, b) = a ∪ b`).
- **Causality**: Each operation includes a `seen` array (causal dependencies), referencing the IDs of prior operations the author knew about at creation time.
- **Determinism**: The set of operations forms a Directed Acyclic Graph (DAG). When deriving the view, operations are topologically sorted. Concurrent operations are deterministically ordered by sorting their SHA-256 IDs.

## 2. Operations

Operations are JSON objects. Each operation has an `id` (SHA-256 hash of its canonical JSON representation) and a `sig` (Ed25519 signature by the author's private key).

There are five valid operation types:

### `genesis`
Creates the webring. 
- **Payload**: `name` (string), `inviteBudget` (number).
- **Rules**: Must be the root of the causal graph. The author becomes the genesis member and the root of the invite tree.

### `add`
Invites a new member to the ring.
- **Payload**: `target` (URL of the new member), `name` (display name).
- **Rules**: Signed by the inviter. The inviter must be an active, unrevoked member and must have remaining invite budget. Target cannot already be in the ring.

### `key-claim`
Upgrades a passive member to an active member by publishing their public key.
- **Payload**: `pubkey` (Ed25519 public key hex).
- **Rules**: Signed by the member claiming the key. Marks the member as active (capable of serving `webring.json` and inviting others).

### `revoke`
Removes a member from the ring.
- **Payload**: `target` (URL of the member to revoke), `reparent` (optional boolean).
- **Rules**: Signed by the *direct inviter* of the target.
- **Hard-Revoke (Cascade)**: If `reparent` is falsy/missing, revoking a member automatically and recursively revokes their entire subtree (everyone they invited, and everyone *they* invited).
- **Soft-Revoke**: If `reparent` is true, the target is removed, but their children are re-parented to the revoker (the inviter who issued the operation), saving the subtree. In both cases, the inviter regains the used invite slot.

### `leave`
A member voluntarily exits the webring.
- **Payload**: None.
- **Rules**: Signed by the leaving member.
- **Re-parenting**: Unlike revocation, leaving does not cascade. Instead, any members invited by the leaving member are re-parented to the leaving member's inviter.

## 3. Cryptography & Canonicalization

To ensure signatures are valid across different peers, operations are canonicalized before hashing and signing:
1. Keys are strictly ordered: `type`, `author`, `timestamp`, `seen`, `payload`.
2. The `seen` array is lexicographically sorted.
3. The `id` and `sig` fields are omitted during signing.

- **Hash**: SHA-256
- **Signature**: Ed25519 (using `@noble/ed25519`)

## 4. Conflict Resolution & Governance

The CRDT guarantees eventual consistency. The following deterministic rules resolve conflicts during view derivation:

1. **Concurrent `add` vs `revoke`**: If an inviter revokes a member, but concurrently invites someone else (exceeding their budget if the revoke isn't processed first), the causal DAG ensures deterministic ordering. If an `add` for the same target happens concurrently with a `revoke` (not causally linked), it is deterministically resolved by causal order + SHA-256 ID tie-breaking. A revoke only successfully removes the target when it causally follows the add.
2. **Invite Budgets**: Enforced strictly at derivation time. If an `add` operation exceeds the author's budget, it is silently ignored.
3. **Ring Ordering**: The visual order of members in the webring is strictly deterministic, sorted by the `SHA-256(member URL)`. This prevents order thrashing as new members are added.
4. **Governance**: The invite tree is the sole source of authority. There are no admin panels or voting protocols. If you invited a node, you have absolute authority to revoke them and their subtree. 

## 5. Network & Hosting

- **Nodes**: Any member who has published a `key-claim` and hosts `<slugified-ring-name>.json` is an "active" node. 
- **CORS**: Active members MUST serve `<slugified-ring-name>.json` with `Access-Control-Allow-Origin: *` to allow client-side widget fetches.
- **Widget Discovery Loop**: The browser widget (`dist/index.widget.js`) bootstraps from known active members. The widget relies on the `data-ring-name` attribute on its `<script>` tag to determine the filename to fetch. To prevent missing subtrees due to a stale bootstrap node, the widget's discovery loop eagerly attempts to fetch state from *all* known members, even those marked passive. Passive members gracefully 404, while recently active members provide their latest state, ensuring the network converges even when some nodes are out of sync.

## 6. Security & Spoofing Mitigation

To protect the integrity of the ring, the CRDT engine enforces strict validation during state merges:
- **Signature Verification**: Every operation is strictly validated against the author's public key (from their `key-claim` op) before it can be merged into the local state.
- **Self-Attesting Keys & Key Rotation**: A `key-claim` operation is self-attesting (signed by the key it publishes). To prevent an attacker from forging a `key-claim` for someone else's domain and hijacking their identity, new `key-claim` operations are only accepted if they are fetched *directly* from the author's domain, or from a trusted bootstrap node. Untrusted peers cannot gossip new `key-claims` for other domains. Multiple `key-claims` are permitted, allowing a member to rotate their keys. However, the key that was current at the op's causal point must sign it; once a member rotates keys, their old key can no longer authorize new operations (enforced during view derivation).
- **Transport-Layer Protocol Validation**: To prevent Cross-Site Scripting (XSS) and protocol exploits, the transport layer strictly rejects any `add` or `genesis` operations containing non-HTTP URLs (e.g., `javascript:`, `data:`). This guarantees that malicious payloads never enter the CRDT state, protecting all downstream consumers (such as the web widget and the CLI).
- **Unauthorized Operations**: If an operation signature is invalid, or if it violates CRDT rules (e.g., revoking someone you didn't invite, or exceeding the invite budget), it is discarded and not gossiped further.

## 7. Comparison to Webchain

da-ring shares the goal of a decentralized, walkable graph of trust with the [Webchain](https://webchain.milkmedicine.net/) protocol, but differs fundamentally in architecture:

- **State Model**: Webchain embeds state via HTML `<link rel="webchain-nomination">` tags, requiring server-side crawlers to traverse the graph and build a visualizer. da-ring uses an explicit JSON CRDT, allowing a lightweight client-side widget to fetch, merge, and render the entire ring in the browser without any central indexer.
- **Authentication**: Webchain nominations are unauthenticated; anyone can add a tag (though they might be ignored if not invited). da-ring enforces cryptographic signatures (Ed25519) on all operations, preventing spoofing and ensuring deterministic state convergence.
- **Subtree Management**: In Webchain, removing a malicious node requires the parent to remove their nomination, but the visualizer crawler semantics determine what happens to the subtree. In da-ring, a `revoke` operation deterministically cascades, immediately purging the revoked node and its entire subtree across all peers.
- **Redundancy**: Webchain nodes only know about their immediate children. da-ring's active nodes host the entire ring state, providing high redundancy and fast bootstrap times for new visitors.
