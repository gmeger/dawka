-- Households: shared dose tracking unit (typically a family).
CREATE TABLE households (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tz            TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  remind_from   TEXT NOT NULL DEFAULT '08:00',  -- HH:MM in household tz
  remind_until  TEXT NOT NULL DEFAULT '10:00',
  created_at    INTEGER NOT NULL
);

-- Users: parents. Many users per household.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  lang          TEXT NOT NULL DEFAULT 'pl',  -- 'pl' | 'en' — used for email content
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_users_household ON users(household_id);

-- Web Push subscriptions. One user can have multiple devices.
CREATE TABLE push_subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- One dose row per household per day. NULL taken_at = not taken yet.
CREATE TABLE doses (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,                   -- YYYY-MM-DD in household tz
  taken_at          INTEGER,                         -- unix ms; NULL = pending
  taken_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_push_at     INTEGER,                         -- when we first nagged
  last_push_at      INTEGER,                         -- last push attempt
  email_sent_at     INTEGER,                         -- email fallback sent (only once per dose)
  UNIQUE(household_id, date)
);

CREATE INDEX idx_doses_household_date ON doses(household_id, date);
CREATE INDEX idx_doses_pending ON doses(household_id, date) WHERE taken_at IS NULL;

-- Magic links for auth. Used for both login and household invites.
-- household_id NULL = login (must match existing user). NOT NULL = invite to that household.
CREATE TABLE magic_links (
  token         TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  household_id  TEXT REFERENCES households(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_magic_email ON magic_links(email);

-- Sessions: long-lived cookie auth.
CREATE TABLE sessions (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
