import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBot, isDatacenter, parseDevice, parseRssSubscribers } from '../src/analytics-core.js'

test('isBot: wp-login is a bot', () => {
  assert.equal(isBot('/wp-login.php', 'Mozilla/5.0'), true)
})

test('isBot: .env path is a bot', () => {
  assert.equal(isBot('/.env', 'Mozilla/5.0'), true)
})

test('isBot: normal post path with browser UA is not a bot', () => {
  assert.equal(isBot('/posts/hello', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false)
})

test('isBot: root path is not a bot', () => {
  assert.equal(isBot('/', 'Mozilla/5.0'), false)
})

test('isBot: path with query string is not a bot', () => {
  assert.equal(isBot('/?t=javascript', 'Mozilla/5.0'), false)
})

test('isBot: bot prefix /wp- is a bot', () => {
  assert.equal(isBot('/wp-admin/', 'Mozilla/5.0'), true)
})

test('isBot: empty UA is suspicious but path-driven', () => {
  assert.equal(isBot('/', ''), false)
  assert.equal(isBot('/wp-login.php', ''), true)
})

test('isBot: slackbot UA is a bot', () => {
  assert.equal(isBot('/', 'Slackbot-LinkExpanding 1.0'), true)
})

test('isBot: WordPress rest_route scanner probe is a bot', () => {
  assert.equal(isBot('/?rest_route=/batch/v1', 'Mozilla/5.0'), true)
  assert.equal(isBot('/blog/?rest_route=%2Fbatch%2Fv1', 'Mozilla/5.0'), true)
})

test('isBot: WordPress wp/v2 path anywhere (not just as a prefix) is a bot', () => {
  assert.equal(isBot('/blog/wp/v2/posts/9999999', 'Mozilla/5.0'), true)
})

test('isBot: /ip probe is a bot', () => {
  assert.equal(isBot('/ip', 'Mozilla/5.0'), true)
})

test('isDatacenter: known datacenter ASN returns true', () => {
  assert.equal(isDatacenter(14618), true) // AWS
  assert.equal(isDatacenter(15169), true) // Google Cloud
  assert.equal(isDatacenter(136907), true) // Huawei Cloud
})

test('isDatacenter: unknown ASN returns false', () => {
  assert.equal(isDatacenter(12345), false)
})

test('isDatacenter: null/undefined ASN is falsy', () => {
  assert.ok(!isDatacenter(null))
  assert.ok(!isDatacenter(undefined))
})

test('isDatacenter: string ASN is coerced', () => {
  assert.equal(isDatacenter('14618'), true)
})

test('parseDevice: mobile UA returns mobile', () => {
  assert.equal(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile')
})

test('parseDevice: Android UA returns mobile', () => {
  assert.equal(parseDevice('Mozilla/5.0 (Linux; Android 13; Pixel 7)'), 'mobile')
})

test('parseDevice: desktop UA returns desktop', () => {
  assert.equal(parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'), 'desktop')
})

test('parseDevice: empty UA returns desktop', () => {
  assert.equal(parseDevice(''), 'desktop')
})

test('parseRssSubscribers: Feedly subscriber count', () => {
  const result = parseRssSubscribers('Feedly/1.0 (42 subscribers; https://feedly.com/i/subscription/feed/...)')
  assert.equal(result?.aggregator, 'Feedly')
  assert.equal(result?.subscribers, 42)
})

test('parseRssSubscribers: Feedbin subscriber count', () => {
  const result = parseRssSubscribers('Feedbin feed-id:123456 - 7 subscribers')
  assert.equal(result?.aggregator, 'Feedbin')
  assert.equal(result?.subscribers, 7)
})

test('parseRssSubscribers: unknown UA returns null', () => {
  assert.equal(parseRssSubscribers('Mozilla/5.0'), null)
})

test('parseRssSubscribers: empty UA returns null', () => {
  assert.equal(parseRssSubscribers(''), null)
})
