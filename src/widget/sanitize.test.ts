import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, sanitizeView } from './sanitize.js'

describe('widget sanitize', () => {
  it('escapes html tags properly', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    assert.equal(escapeHtml('foo & bar'), 'foo &amp; bar')
    assert.equal(escapeHtml(`'test'`), '&#039;test&#039;')
  })

  it('sanitizes the full RingView properly', () => {
    const rawView = {
      name: '<bold>Ring</bold>',
      members: [
        {
          url: 'https://foo.site/?a=1&b=2',
          name: '<script>alert(1)</script>',
          invitedBy: null,
          pubkey: null,
          isActive: true,
          depth: 0
        }
      ]
    }

    const safeView = sanitizeView(rawView as any)

    assert.equal(safeView.name, '&lt;bold&gt;Ring&lt;/bold&gt;')
    assert.equal(safeView.members[0].name, '&lt;script&gt;alert(1)&lt;/script&gt;')
    assert.equal(safeView.members[0].url, 'https://foo.site/?a=1&amp;b=2')
  })
})
