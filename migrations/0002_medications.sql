-- F2: per-household medication with slots or hours-based schedule.
-- Refactor doses: keyed by scheduled_at (unix ms) instead of date string,
-- so multiple doses per day are first-class.

CREATE TABLE medications (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  dose              TEXT NOT NULL DEFAULT '',
  schedule_type     TEXT NOT NULL CHECK(schedule_type IN ('slots','hours')),
  -- slots: '1-0-0' / '1-0-1' / '1-1-1' etc. — '1' = take dose at this slot, '0' = skip.
  -- hours: positive integer like '8' = every 8 hours from hours_anchor.
  schedule_pattern  TEXT NOT NULL,
  morning_at        TEXT NOT NULL DEFAULT '08:00',
  noon_at           TEXT NOT NULL DEFAULT '14:00',
  evening_at        TEXT NOT NULL DEFAULT '20:00',
  hours_anchor      INTEGER,                                  -- unix ms; first dose for hours mode
  hours_until       INTEGER,                                  -- unix ms; antibiotic course end (NULL = open-ended)
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_medications_active ON medications(household_id, active);

-- Bootstrap a default medication for each existing household, mirroring the previous
-- "single 8:00 daily dose" behaviour. ID format here is 32 hex chars (not UUID with
-- hyphens) — app code uses crypto.randomUUID() for new rows; the schema accepts any TEXT.
INSERT INTO medications (
  id, household_id, name, dose, schedule_type, schedule_pattern,
  morning_at, noon_at, evening_at, active, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  h.id,
  'Lek',
  '1 dawka',
  'slots',
  '1-0-0',
  COALESCE(h.remind_from, '08:00'),
  '14:00',
  '20:00',
  1,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
FROM households h;

-- Drop old doses table (≤1 day of history; acceptable loss for personal MVP).
DROP INDEX IF EXISTS idx_doses_household_date;
DROP INDEX IF EXISTS idx_doses_pending;
DROP TABLE doses;

CREATE TABLE doses (
  id                TEXT PRIMARY KEY,
  medication_id     TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  household_id      TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scheduled_at      INTEGER NOT NULL,                           -- unix ms
  scheduled_label   TEXT NOT NULL,                              -- 'morning'/'noon'/'evening' or 'HH:MM'
  taken_at          INTEGER,
  taken_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_alert_at    INTEGER,
  last_alert_at     INTEGER,
  email_sent_at     INTEGER,
  UNIQUE(medication_id, scheduled_at)
);

CREATE INDEX idx_doses_med_scheduled ON doses(medication_id, scheduled_at);
CREATE INDEX idx_doses_household ON doses(household_id, scheduled_at);
CREATE INDEX idx_doses_pending ON doses(scheduled_at) WHERE taken_at IS NULL;

-- households.remind_from / remind_until are obsolete now — windows live per medication.
ALTER TABLE households DROP COLUMN remind_from;
ALTER TABLE households DROP COLUMN remind_until;
