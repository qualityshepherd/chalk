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
4. `npx wrangler deploy`
5. Visit `/login` — it'll walk you through generating `AUTH_PUBKEY` from a passphrase. Add that to `wrangler.toml` and deploy again.

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
