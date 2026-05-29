-- SafeTrax Seed Data (development / testing)
-- Run: sqlite3 database/safetrax.db < database/seed.sql

-- ── Users ────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (name, email, password_hash, dob, citizenship, blood_type,
  health_concerns, emergency_contact_name, emergency_contact_phone,
  consent_signed, consent_date, created_at)
VALUES
  ('Alice Chen',      'alice@example.com',   '$2b$10$abc1', '1992-03-15', 'US', 'A+',
   '["peanut allergy"]',         'Bob Chen',     '+1-206-555-0101', 1, '2026-01-10', datetime('now','-45 days')),
  ('Marco Rossi',     'marco@example.com',   '$2b$10$abc2', '1988-07-22', 'IT', 'O+',
   '["asthma","diabetes"]',      'Lucia Rossi',  '+39-02-555-0102', 1, '2026-01-18', datetime('now','-38 days')),
  ('Priya Sharma',    'priya@example.com',   '$2b$10$abc3', '1995-11-30', 'IN', 'B+',
   '[]',                         'Raj Sharma',   '+91-98-555-0103', 1, '2026-02-05', datetime('now','-30 days')),
  ('James Okafor',    'james@example.com',   '$2b$10$abc4', '1990-05-12', 'NG', 'O-',
   '["hypertension"]',           'Ngozi Okafor', '+234-80-555-0104', 1, '2026-02-14', datetime('now','-22 days')),
  ('Sophie Laurent',  'sophie@example.com',  '$2b$10$abc5', '1997-09-08', 'FR', 'AB+',
   '["celiac disease"]',         'Pierre L.',    '+33-1-555-0105',  1, '2026-02-20', datetime('now','-18 days')),
  ('Hiroshi Tanaka',  'hiroshi@example.com', '$2b$10$abc6', '1985-02-28', 'JP', 'A-',
   '[]',                         'Yuki Tanaka',  '+81-3-555-0106',  1, '2026-03-01', datetime('now','-14 days')),
  ('Ana Gutierrez',   'ana@example.com',     '$2b$10$abc7', '1993-12-04', 'MX', 'B-',
   '["penicillin allergy"]',     'Carlos G.',    '+52-55-555-0107', 1, '2026-03-10', datetime('now','-10 days')),
  ('Liam OBrien',     'liam@example.com',    '$2b$10$abc8', '1991-06-17', 'IE', 'O+',
   '["asthma"]',                 'Niamh O.',     '+353-1-555-0108', 1, '2026-03-18', datetime('now','-6 days')),
  ('Fatima Al-Rashid','fatima@example.com',  '$2b$10$abc9', '1996-04-25', 'SA', 'A+',
   '["diabetes"]',               'Ahmed A.',     '+966-11-555-0109',1, '2026-04-01', datetime('now','-3 days')),
  ('Chen Wei',        'chenwei@example.com', '$2b$10$abcA', '1989-08-14', 'CN', 'AB-',
   '["heart condition"]',        'Lin Wei',      '+86-10-555-0110', 1, '2026-04-10', datetime('now','-1 days'));

-- ── Travel Plans ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO travel_plans (user_id, date_start, date_end, transport, status, created_at) VALUES
  (1, '2026-06-10', '2026-06-20', 'air',    'active',    datetime('now','-40 days')),
  (1, '2025-12-20', '2026-01-03', 'air',    'completed', datetime('now','-90 days')),
  (2, '2026-07-01', '2026-07-15', 'air',    'active',    datetime('now','-35 days')),
  (3, '2026-05-15', '2026-05-25', 'air',    'active',    datetime('now','-28 days')),
  (3, '2026-03-01', '2026-03-10', 'train',  'completed', datetime('now','-60 days')),
  (4, '2026-08-05', '2026-08-18', 'air',    'active',    datetime('now','-20 days')),
  (5, '2026-06-25', '2026-07-05', 'air',    'active',    datetime('now','-15 days')),
  (6, '2026-09-10', '2026-09-20', 'air',    'active',    datetime('now','-12 days')),
  (7, '2026-06-01', '2026-06-08', 'air',    'active',    datetime('now','-8 days')),
  (8, '2026-07-20', '2026-08-01', 'cruise', 'active',    datetime('now','-5 days'));

-- ── Destinations ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO destinations (travel_plan_id, seq, country_code, state_code, city) VALUES
  (1, 1, 'JP', NULL,  'Tokyo'),
  (1, 2, 'JP', NULL,  'Kyoto'),
  (2, 1, 'TH', NULL,  'Bangkok'),
  (2, 2, 'TH', NULL,  'Phuket'),
  (3, 1, 'AU', NULL,  'Sydney'),
  (3, 2, 'NZ', NULL,  'Auckland'),
  (4, 1, 'FR', NULL,  'Paris'),
  (5, 1, 'DE', NULL,  'Berlin'),
  (5, 2, 'NL', NULL,  'Amsterdam'),
  (6, 1, 'ZA', NULL,  'Cape Town'),
  (6, 2, 'KE', NULL,  'Nairobi'),
  (7, 1, 'US', 'NY',  'New York'),
  (7, 2, 'US', 'CA',  'San Francisco'),
  (8, 1, 'KR', NULL,  'Seoul'),
  (9, 1, 'ES', NULL,  'Barcelona'),
  (9, 2, 'PT', NULL,  'Lisbon'),
  (10, 1, 'MX', NULL, 'Cancun'),
  (10, 2, 'MX', NULL, 'Mexico City');

-- ── Checklist items ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO plan_checklist (travel_plan_id, item_key, checked) VALUES
  (1, 'check_immigration_visa',  1),
  (1, 'check_vaccinations',      1),
  (1, 'check_travel_insurance',  1),
  (1, 'check_emergency_contacts',0),
  (3, 'check_immigration_visa',  1),
  (3, 'check_vaccinations',      0),
  (3, 'check_travel_insurance',  1),
  (4, 'check_immigration_visa',  1),
  (4, 'check_vaccinations',      1),
  (6, 'check_immigration_visa',  0),
  (6, 'check_vaccinations',      1);

-- ── User Locations ────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO user_locations (user_id, latitude, longitude, city, country_code, note) VALUES
  (1, 35.6762,  139.6503, 'Tokyo',         'JP', 'Arrived safely'),
  (2, 41.9028,  12.4964,  'Rome',          'IT', 'Transit stop'),
  (3, 48.8566,   2.3522,  'Paris',         'FR', 'Conference day 1'),
  (4,  6.5244,   3.3792,  'Lagos',         'NG', 'Home base'),
  (5, 22.3193, 114.1694,  'Hong Kong',     'CN', 'Layover'),
  (6, 35.6762,  139.6503, 'Tokyo',         'JP', 'Work trip'),
  (7, 19.4326, -99.1332,  'Mexico City',   'MX', 'Family visit'),
  (8, 53.3498,  -6.2603,  'Dublin',        'IE', 'Home');

-- ── Friends ───────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO friends (user_id, friend_user_id, friend_email, status) VALUES
  (1, 2, 'marco@example.com',  'active'),
  (1, 3, 'priya@example.com',  'active'),
  (2, 1, 'alice@example.com',  'active'),
  (3, 1, 'alice@example.com',  'active'),
  (3, 4, 'james@example.com',  'pending'),
  (5, 6, 'hiroshi@example.com','active'),
  (6, 5, 'sophie@example.com', 'active');

-- ── Notifications ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO notifications (user_id, type, title, message, country_code, read) VALUES
  (1, 'risk_alert',    'Risk update: Japan',         'CDC issued a Level 1 Watch for Japan. Review your travel plan.', 'JP', 0),
  (1, 'plan_reminder', 'Trip starts in 12 days',     'Your Japan trip starts June 10. Check your checklist.', 'JP', 0),
  (2, 'risk_alert',    'Risk update: Australia',     'WHO reports an active outbreak near your destination.', 'AU', 1),
  (3, 'friend_update', 'Alice is now in Tokyo',      'Your friend Alice Chen checked in from Tokyo, Japan.', 'JP', 0),
  (4, 'system',        'Welcome to SafeTrax',        'Your account is set up. Add your first travel plan to get started.', NULL, 1),
  (6, 'risk_alert',    'Risk update: South Africa',  'Level 2 CDC Alert active for South Africa. Review advisories.', 'ZA', 0);

-- ── SOS Events (sample resolved) ─────────────────────────────────────────────
INSERT OR IGNORE INTO sos_events (user_id, latitude, longitude, country_code, message, status, resolved_at) VALUES
  (3, 48.8566, 2.3522, 'FR', 'Lost phone, need help at hotel', 'resolved', datetime('now','-25 days'));

-- ── Audit Log ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO audit_log (user_id, action, detail) VALUES
  (1, 'login',          '{"method":"email"}'),
  (1, 'plan_created',   '{"plan_id":1,"destination":"JP"}'),
  (2, 'login',          '{"method":"email"}'),
  (3, 'profile_update', '{"fields":["phone","address"]}'),
  (3, 'sos',            '{"lat":48.8566,"lng":2.3522,"country":"FR"}');
