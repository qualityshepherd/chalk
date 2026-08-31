CREATE TABLE challenge_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
