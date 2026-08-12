import test from 'node:test'
import assert from 'node:assert'
import { slugify } from './utils.js'

test('slugify', async (t) => {
  await t.test('handles basic spaces', () => {
    assert.strictEqual(slugify('My Webring'), 'my-webring')
  })

  await t.test('handles special characters', () => {
    assert.strictEqual(slugify("Kek's Ring!"), 'keks-ring')
  })

  await t.test('handles multiple spaces', () => {
    assert.strictEqual(slugify('My   Cool   Ring'), 'my-cool-ring')
  })

  await t.test('trims trailing and leading hyphens', () => {
    assert.strictEqual(slugify(' - Awesome Ring - '), 'awesome-ring')
  })

  await t.test('handles entirely weird characters', () => {
    assert.strictEqual(slugify('!!@@##'), '')
  })
})
