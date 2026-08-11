import { sha512 } from '@noble/hashes/sha512'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

// ed25519 needs a sha512 implementation
ed.etc.sha512Sync = (...msgs) => {
  const h = sha512.create()
  for (const m of msgs) h.update(m)
  return h.digest()
}

export interface Keypair {
  publicKey: string   // hex
  privateKey: string  // hex
}

/** Generate a new Ed25519 keypair */
export function generateKeypair(): Keypair {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = ed.getPublicKey(privateKey)
  return {
    publicKey: bytesToHex(publicKey),
    privateKey: bytesToHex(privateKey),
  }
}

/** Sign a message string with a private key */
export function sign(message: string, privateKey: string): string {
  const msgBytes = new TextEncoder().encode(message)
  const sig = ed.sign(msgBytes, hexToBytes(privateKey))
  return bytesToHex(sig)
}

/** Verify a signature against a message and public key */
export function verify(message: string, signature: string, publicKey: string): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message)
    return ed.verify(hexToBytes(signature), msgBytes, hexToBytes(publicKey))
  } catch {
    return false
  }
}

/** SHA-256 hash of a string, returned as hex */
export function hash(content: string): string {
  const bytes = new TextEncoder().encode(content)
  return bytesToHex(sha256(bytes))
}
