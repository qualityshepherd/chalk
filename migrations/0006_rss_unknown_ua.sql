-- Temporary debug table: samples real UA strings behind RSS hits that
-- classifyRssClient() couldn't name, so the "Top RSS Clients" pattern list
-- can be expanded from actual traffic instead of guesses. Drop this table
-- (and recordUnknownRssUa in db.js) once that expansion is done.
CREATE TABLE rss_unknown_ua (
  domain TEXT NOT NULL,
  ua TEXT NOT NULL,
  path TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (domain, ua)
);
