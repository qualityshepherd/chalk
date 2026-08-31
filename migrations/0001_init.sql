CREATE TABLE hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  ts INTEGER NOT NULL,
  path TEXT NOT NULL,
  country TEXT,
  city TEXT,
  region TEXT,
  device TEXT,
  referrer TEXT,
  ip_hash TEXT,
  asn INTEGER,
  rss_feed TEXT,
  rss_subs INTEGER
);

CREATE INDEX idx_hits_domain_ts ON hits (domain, ts);
CREATE INDEX idx_hits_ts ON hits (ts);

CREATE TABLE bot_counts (
  domain TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, date)
);

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE challenge_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
