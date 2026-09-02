CREATE TABLE domains (
  domain TEXT PRIMARY KEY
);

-- One-time backfill so existing domains show up immediately - going
-- forward, insertHit keeps this table current instead of ever scanning
-- the full hits table again.
INSERT INTO domains (domain) SELECT DISTINCT domain FROM hits;
