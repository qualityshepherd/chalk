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
2. `npx wrangler d1 create chalk` — paste the `database_id` it gives you into `wrangler.toml`
3. Pick a `HIT_SECRET` value and put it in `wrangler.toml`
4. `npx wrangler secret put IP_SALT` — see [Privacy](#privacy) for what to use
5. `npx wrangler d1 migrations apply chalk --remote`
6. `npx wrangler deploy`
7. Visit `/login` — it'll walk you through generating `AUTH_PUBKEY` from a passphrase. Add that to `wrangler.toml` and deploy again.

`npm test` runs the suite and `standard` over everything.

## Privacy

Visitor IPs are never stored. They're hashed with a secret salt on the way
in, and only the first 8 bytes of the digest are kept — enough to tell two
visits apart, not enough to be an address.

The salt matters more than it looks. IPv4 is only 2^32 addresses, so an
*unsalted* hash rainbow-tables in minutes and the column is an IP log
wearing a costume — truncating it doesn't help, you build the table
truncated too.

```
npx wrangler secret put IP_SALT
```

A long original sentence is fine, and easier to keep than random hex. Don't
use a famous quote — song lyrics and movie lines are in wordlists, which is
the one thing that makes guessing the salt cheap. Length is what does the
work, not punctuation or digits.

As a secret rather than a `[vars]` entry, so it isn't sitting in plaintext
in a config file. Keep it separate from `HIT_SECRET`: that one is a bearer
token copied into every app that forwards hits, and rotating it after a leak
would silently re-anonymize the whole history as a side effect.

If `IP_SALT` is unset, `hashIp` returns `null` rather than an unsalted hash —
hits still record, but uniques read zero. That's deliberate: a missing salt
should be loud, not quietly fake.

Changing the salt orphans every existing hash. Cross-day uniques read oddly
for the window spanning the change, then heal. Nothing else cares.

## Retention

90 days (`RETENTION_DAYS` in `src/index.js`), swept nightly by the cron in
`wrangler.toml`. Every server log on earth rotates; this one didn't, so it
held every visitor since the table was created.

The sweep also drops expired rows from `login_attempts` and
`challenge_attempts`. Those key on the **raw** address rather than a hash —
the only cleartext IPs in the database — and nothing had ever deleted from
them. An expired row already counts as no row, so this changes no behaviour.

The dashboard's window selector caps at 90 days to match, so it can't be
asked for a range that's mostly guaranteed-empty days.

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
    path,                      // required — pathname + query string
    ip,                        // required — req.headers.get('cf-connecting-ip')
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

3. Skip what you already know isn't worth tracking — static assets, health
   checks, internal routes.
4. `.catch(() => {})` on the fetch — a hit failing to send should never
   break the actual page request.
