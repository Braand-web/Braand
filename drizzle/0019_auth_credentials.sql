CREATE TABLE auth_passwords (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE auth_pending_passwords (
  challenge_id TEXT PRIMARY KEY REFERENCES auth_challenges(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  iterations INTEGER NOT NULL
);
CREATE TABLE auth_google_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_google_states_expiry ON auth_google_states(expires_at);
CREATE TABLE auth_google_identities (
  subject TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
