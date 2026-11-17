# chalk

Centralized analytics for brine.dev apps (brine, discover, rando...)

I got really tired of maintaining analytics in multiple apps, thus chalk was born.

- **app decides scope**: is this hit even worth sending (skip static
  assets, identify feed routes, etc.). Only the app knows its own routing.
- **Chalk decides substance**: is this a bot, a datacenter IP, mobile vs
  desktop, an RSS aggregator. Judged the same way for every property, in one
  place (`src/analytics-core.js`), so a fix there fixes it everywhere at once.

## Deploying

1. `cp wrangler.example.toml wrangler.toml`
2. `npx wrangler d1 create chalk`, then paste the `database_id` it gives you into `wrangler.toml`
3. Pick a `HIT_SECRET` value and put it in `wrangler.toml`
4. `npx wrangler secret put IP_SALT` (see [Privacy](#privacy) for what to use)
5. `npx wrangler d1 migrations apply chalk --remote`
6. `npx wrangler deploy`
7. Visit `/login`. It'll walk you through generating `AUTH_PUBKEY` from a passphrase. Add that to `wrangler.toml` and deploy again.

`npm test` runs the tests plus `standard` over everything.

## Privacy

I don't keep anyone's IP address. It gets scrambled on the way in, mixed
together with a secret phrase (the `IP_SALT`), and I only keep the first 8
bytes of the result. That's enough to tell two visitors apart. It isn't
enough to be an address.

The secret phrase is the part doing the actual work. Without it the
scrambling is decoration, because there are only about 4 billion possible
IPv4 addresses. A laptop can scramble every single one of them in a few
minutes, keep the answers in a big list, and then look up anything it finds
in my database to get the real address back. Only keeping 8 bytes doesn't
save me either, since you'd just build your list the same way. Stir in a
phrase nobody else knows and the whole trick stops working, because now your
list is for the wrong puzzle.

```
npx wrangler secret put IP_SALT
```

Use a long sentence. Something I'd actually write that nobody else would.
Not a song lyric or a movie line, because those are all sitting in wordlists
somewhere and guessing gets cheap again. Length is what matters, not
punctuation or numbers or capital letters.

It goes in as a secret instead of a `[vars]` entry so it isn't sitting in a
config file in plain text. Keep it separate from `HIT_SECRET`, which is the
password every app needs in order to send me hits. If that one ever leaks
and I change it, I don't want to also disconnect every visitor hash I've
already got.

If `IP_SALT` isn't set at all, `hashIp` hands back `null` rather than
scrambling without it. Hits still get recorded, but uniques read zero. That's
on purpose: a missing salt should be loud and obvious, not quietly pretend
everything's fine.

Changing the salt orphans every hash I already have. Cross-day uniques read
strangely for whatever window straddles the change, then sort themselves out.
Nothing else cares.

## Retention

90 days, set by `RETENTION_DAYS` in `src/index.js`, swept out every night by
the cron in `wrangler.toml`. Every web server on earth rotates its logs. This
one didn't, so it was quietly holding onto every visitor since the day I
created the table.

That same sweep clears expired rows out of `login_attempts` and
`challenge_attempts`. Those two store the raw address instead of a hash, so
they were the only real IPs in here, and nothing had ever deleted from them.
An expired row already counts as no row, so dropping them doesn't change how
the rate limiting behaves.

The window picker on the dashboard stops at 90 days to match. No sense
offering a year when most of it would be empty.

## Hooking up a new app

1. Add a `HIT_SECRET`-matching var to the new app's `wrangler.toml` (must
   match chalk's own `HIT_SECRET`).
2. Fire a non-blocking `POST` to `https://chalk.brine.dev/hit` on real
   requests, with the shared secret and raw signal:

```js
await fetch('https://chalk.brine.dev/hit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-hit-secret': env.CHALK_HIT_SECRET },
  body: JSON.stringify({
    domain: env.DOMAIN_NAME,   // required
    path,                      // required: pathname + query string
    ip,                        // required: req.headers.get('cf-connecting-ip')
    ua: req.headers.get('user-agent') || '',
    referrer,                  // only if cross-origin
    country: req.cf?.country,
    city: req.cf?.city,
    region: req.cf?.region,
    asn: req.cf?.asn,
    rss_feed: rssFeedName,     // string if this path is a feed, else omit
    ts: Date.now()
  })
}).catch(() => {})
```

3. Skip what you already know isn't worth tracking: static assets, health
   checks, internal routes.
4. `.catch(() => {})` on the fetch. A hit failing to send should never break
   the actual page request.
