-- SafeTrax Database Schema
-- Compatible with SQLite (default), PostgreSQL, MySQL (minor type adjustments needed)
-- Run: sqlite3 safetrax.db < schema.sql

-- ─────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  email                   TEXT    NOT NULL UNIQUE,
  password_hash           TEXT    NOT NULL,           -- bcrypt hash, never plaintext
  dob                     TEXT,                       -- ISO date e.g. 1995-04-20
  address                 TEXT,
  phone                   TEXT,
  citizenship             TEXT,                       -- ISO country code e.g. US
  height_ft               REAL,
  weight_lbs              REAL,
  blood_type              TEXT,
  race_ethnicity          TEXT,
  health_concerns         TEXT,                       -- JSON array e.g. ["diabetes","asthma"]
  health_other            TEXT,
  vaccination_history     TEXT,
  additional_note         TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  consent_signed          INTEGER NOT NULL DEFAULT 0, -- 1 = agreed
  signature               TEXT,
  consent_date            TEXT,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- TRAVEL PLANS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS travel_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  date_start  TEXT    NOT NULL,   -- ISO date
  date_end    TEXT    NOT NULL,   -- ISO date
  transport   TEXT,               -- air | car | train | bus | cruise | other
  status      TEXT    NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One plan can have multiple destinations (multi-leg trips)
CREATE TABLE IF NOT EXISTS destinations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  travel_plan_id  INTEGER NOT NULL,
  seq             INTEGER NOT NULL DEFAULT 1,  -- order of destinations in the trip
  country_code    TEXT    NOT NULL,            -- ISO 2-letter code e.g. US
  state_code      TEXT,                        -- e.g. CA (US only)
  city            TEXT,
  FOREIGN KEY (travel_plan_id) REFERENCES travel_plans(id) ON DELETE CASCADE
);

-- Checklist items per travel plan (e.g. visa checked, vaccine checked)
CREATE TABLE IF NOT EXISTS plan_checklist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  travel_plan_id  INTEGER NOT NULL,
  item_key        TEXT    NOT NULL,  -- e.g. check_immigration_visa
  checked         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (travel_plan_id) REFERENCES travel_plans(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- REAL-TIME LOCATION LOG
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_locations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  latitude     REAL,
  longitude    REAL,
  city         TEXT,
  country_code TEXT,
  note         TEXT,   -- user's real-time update note
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- FRIENDS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friends (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  friend_user_id  INTEGER,           -- NULL if friend has no account yet
  friend_email    TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'invited', -- invited | pending | active
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────
-- API DATA — CDC TRAVEL NOTICES (fetched & cached)
-- ─────────────────────────────────────────────
-- Source: https://wwwnc.cdc.gov/travel/notices/rss.xml
-- Levels: 1=Watch, 2=Alert, 3=Warning
CREATE TABLE IF NOT EXISTS cdc_notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guid         TEXT    UNIQUE,      -- RSS item GUID for deduplication
  title        TEXT    NOT NULL,
  country_name TEXT,
  country_code TEXT,               -- resolved ISO code
  alert_level  INTEGER NOT NULL,   -- 1, 2, or 3
  url          TEXT,
  published_at TEXT,               -- pubDate from RSS
  fetched_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- API DATA — WHO DISEASE OUTBREAK NEWS (fetched & cached)
-- ─────────────────────────────────────────────
-- Source: https://www.who.int/feeds/entity/csr/don/en/rss.xml
CREATE TABLE IF NOT EXISTS who_outbreaks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guid         TEXT    UNIQUE,
  title        TEXT    NOT NULL,
  country_name TEXT,
  country_code TEXT,
  recency      TEXT    NOT NULL,   -- active (<30d) | recent (30-90d) | historical (90-180d)
  url          TEXT,
  published_at TEXT,
  fetched_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- API DATA — NEWS ITEMS (fetched & cached from NewsAPI)
-- ─────────────────────────────────────────────
-- Source: https://newsapi.org (requires API key, paid plan for server-side production)
CREATE TABLE IF NOT EXISTS news_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  description  TEXT,
  source       TEXT,
  url          TEXT    UNIQUE,
  is_negative  INTEGER NOT NULL DEFAULT 1,  -- 1 = flagged as safety-negative
  published_at TEXT,
  fetched_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- COMPUTED RISK SCORES (cached per destination)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scores (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code        TEXT    NOT NULL,
  state_code          TEXT,
  city                TEXT,
  score               REAL    NOT NULL,  -- final score 0–10
  cdc_component       REAL    NOT NULL,  -- 0–10, weighted input
  who_component       REAL    NOT NULL,
  news_component      REAL    NOT NULL,
  base_component      REAL    NOT NULL,
  cdc_notices_json    TEXT,              -- JSON snapshot of matched CDC notices
  who_outbreaks_json  TEXT,              -- JSON snapshot of matched WHO outbreaks
  news_items_json     TEXT,              -- JSON snapshot of top 5 news items
  calculated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT    NOT NULL   -- set to +1 hour from calculated_at
);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  type         TEXT    NOT NULL,  -- risk_alert | friend_update | plan_reminder | system
  title        TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  country_code TEXT,              -- related country if applicable
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- AUDIT LOG
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,             -- NULL for system events
  action     TEXT    NOT NULL,   -- login | logout | profile_update | plan_created | sos | etc.
  detail     TEXT,               -- JSON with relevant context
  ip_address TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────
-- USER SESSIONS (JWT token store)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token      TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- SOS EVENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sos_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  latitude     REAL,
  longitude    REAL,
  country_code TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | resolved
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_travel_plans_user   ON travel_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_destinations_plan   ON destinations(travel_plan_id);
CREATE INDEX IF NOT EXISTS idx_locations_user      ON user_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_user        ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_cdc_country         ON cdc_notices(country_code);
CREATE INDEX IF NOT EXISTS idx_who_country         ON who_outbreaks(country_code);
CREATE INDEX IF NOT EXISTS idx_news_country        ON news_items(country_code, fetched_at);
CREATE INDEX IF NOT EXISTS idx_risk_country_expiry  ON risk_scores(country_code, expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_audit_user           ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token       ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sos_user             ON sos_events(user_id, status);
