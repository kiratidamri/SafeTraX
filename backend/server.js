'use strict';

/**
 * SafeTrax API Server
 *
 * Start:  node server.js
 * Env:    NEWS_API_KEY=<your_key> ANTHROPIC_API_KEY=<your_key> node server.js
 *
 * Endpoints:
 *   GET  /api/risk?country=US[&state=CA&city=San+Francisco]
 *   POST /api/chat            — FAQ chatbot (Claude or rule-based fallback)
 *   POST /api/users           — register user
 *   POST /api/login           — authenticate user → returns session token
 *   POST /api/logout          — invalidate session token
 *   GET  /api/me              — validate session token, return user
 *   POST /api/travel-plans    — save travel plan
 *   POST /api/locations       — save real-time location
 *   GET  /api/notifications   — user notifications
 *   POST /api/notifications/read — mark read
 *   GET  /api/trips           — trip history
 *   POST /api/sos             — send SOS alert
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const Anthropic  = require('@anthropic-ai/sdk');
const { DatabaseSync } = require('node:sqlite'); // built-in since Node v22
const { fetchRiskData, fetchGlobalFeed } = require('./riskScorer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Database setup ──────────────────────────────────────────────────────────
const DB_PATH     = path.join(__dirname, '../database/safetrax.db');
const SCHEMA_PATH = path.join(__dirname, '../database/schema.sql');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Apply schema (CREATE IF NOT EXISTS is safe to run on every start)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Run migrations for existing databases
[
  'ALTER TABLE users ADD COLUMN travel_frequency   TEXT',
  'ALTER TABLE users ADD COLUMN travel_purpose     TEXT',
  'ALTER TABLE users ADD COLUMN traveler_type      TEXT',
  'ALTER TABLE users ADD COLUMN insurance_status   INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN vaccination_status TEXT',
].forEach(function(sql) {
  try { db.exec(sql); } catch(e) { /* column already exists */ }
});

// ─── GET /api/risk ───────────────────────────────────────────────────────────
app.get('/api/risk', async (req, res) => {
  const { country, state, city } = req.query;
  if (!country) return res.status(400).json({ error: 'country query param is required (ISO 2-letter code)' });

  try {
    // Return cached result if not expired
    const cached = db.prepare(`
      SELECT * FROM risk_scores
      WHERE country_code = ?
        AND (state_code = ? OR (state_code IS NULL AND ? IS NULL))
        AND expires_at > datetime('now')
      ORDER BY calculated_at DESC
      LIMIT 1
    `).get(country.toUpperCase(), state || null, state || null);

    if (cached) {
      return res.json({
        score:      cached.score,
        breakdown: {
          cdc:  cached.cdc_component,
          who:  cached.who_component,
          news: cached.news_component,
          base: cached.base_component,
        },
        sources: {
          cdc_notices:   JSON.parse(cached.cdc_notices_json  || '[]'),
          who_outbreaks: JSON.parse(cached.who_outbreaks_json || '[]'),
          news_items:    JSON.parse(cached.news_items_json   || '[]'),
        },
        cached:       true,
        calculated_at: cached.calculated_at,
      });
    }

    // Compute fresh score
    const result = await fetchRiskData({ country, state, city });

    // Cache for 1 hour
    db.prepare(`
      INSERT INTO risk_scores
        (country_code, state_code, city, score,
         cdc_component, who_component, news_component, base_component,
         cdc_notices_json, who_outbreaks_json, news_items_json, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now','+1 hour'))
    `).run(
      country.toUpperCase(), state || null, city || null,
      result.score,
      result.breakdown.cdc, result.breakdown.who,
      result.breakdown.news, result.breakdown.base,
      JSON.stringify(result.sources.cdc_notices),
      JSON.stringify(result.sources.who_outbreaks),
      JSON.stringify(result.sources.news_items),
    );

    // Persist individual API records for audit/history
    const insertCDC = db.prepare(`
      INSERT OR IGNORE INTO cdc_notices (title, country_code, alert_level, url, published_at)
      VALUES (?,?,?,?,?)
    `);
    for (const n of result.sources.cdc_notices) {
      const isGlobal = /global|worldwide/i.test(n.title);
      insertCDC.run(n.title, isGlobal ? 'GLOBAL' : country.toUpperCase(), n.level, n.url, n.published_at);
    }

    const insertWHO = db.prepare(`
      INSERT OR IGNORE INTO who_outbreaks (title, country_code, recency, url, published_at)
      VALUES (?,?,?,?,?)
    `);
    for (const o of result.sources.who_outbreaks) {
      insertWHO.run(o.title, country.toUpperCase(), o.recency, o.url, o.published_at);
    }

    const insertNews = db.prepare(`
      INSERT OR IGNORE INTO news_items (country_code, title, description, source, url, published_at)
      VALUES (?,?,?,?,?,?)
    `);
    for (const a of result.sources.news_items) {
      insertNews.run(country.toUpperCase(), a.title, a.description, a.source, a.url, a.published_at);
    }

    res.json({ ...result, cached: false });

  } catch (err) {
    console.error('[/api/risk]', err.message);
    res.status(500).json({ error: 'Risk computation failed', detail: err.message });
  }
});

// ─── GET /api/news ───────────────────────────────────────────────────────────
// Returns the latest health & safety news for the homepage feed.
// Tries the DB cache first; if fewer than 5 rows exist, does a live global
// fetch from CDC (HTML scrape), ReliefWeb RSS, and NewsAPI.
app.get('/api/news', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  try {
    const cdc  = db.prepare(`SELECT 'CDC' AS source, title, url, published_at, alert_level AS level, country_code FROM cdc_notices  ORDER BY id DESC LIMIT ?`).all(limit);
    const who  = db.prepare(`SELECT 'WHO' AS source, title, url, published_at, recency       AS level, country_code FROM who_outbreaks ORDER BY id DESC LIMIT ?`).all(limit);
    const news = db.prepare(`SELECT source,           title, url, published_at, NULL          AS level, country_code FROM news_items   ORDER BY id DESC LIMIT ?`).all(limit);

    const cached = [...cdc, ...who, ...news]
      .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
      .slice(0, limit);

    // Enough cached data — return immediately
    if (cached.length >= 5) {
      return res.json({ items: cached, source: 'cache' });
    }

    // Cache is thin — do a live global fetch
    const live = await fetchGlobalFeed();
    const merged = [...cached, ...live]
      .filter((item, idx, arr) => arr.findIndex(x => x.title === item.title) === idx)
      .slice(0, limit);

    res.json({ items: merged, source: 'live' });
  } catch (err) {
    console.error('[/api/news]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chat ──────────────────────────────────────────────────────────
// If ANTHROPIC_API_KEY is set, answers via Claude claude-opus-4-6.
// Otherwise falls back to a small rule-based FAQ engine.

const SAFETRAX_SYSTEM = `You are the SafeTrax Assistant, a friendly and concise travel-safety helper
embedded in the SafeTrax mobile app. SafeTrax helps travellers assess health and
security risks for destinations worldwide using data from CDC travel notices,
WHO/ReliefWeb outbreak reports, and news sentiment analysis.

Answer questions about:
- How the risk score (0-10) is calculated (CDC 40%, WHO 30%, news 20%, base 10%)
- CDC travel notice levels: Level 1 = watch, Level 2 = alert, Level 3 = warning
- WHO / ReliefWeb outbreak alerts
- Vaccination recommendations and requirements for specific countries
- How to create a travel plan inside SafeTrax
- How real-time location tracking works in the app
- Emergency contacts and profile settings
- General travel safety tips

Keep answers brief, practical, and mobile-friendly. Use plain text (no markdown
bold/italic) and avoid long bullet lists. If asked something outside travel safety,
gently redirect to travel-related topics. Never invent specific medical advice.
- Specific country risk questions: when asked about safety of a destination, reference the risk score scale and suggest using the Destinations page for a live score
- User's active travel plans and health concerns (if user_id provided in context above)`;

// Rule-based fallback (used when no API key is configured)
function ruleBasedReply(text) {
  var t = text.toLowerCase();
  if (/risk.?score|how.*calcul|formula/.test(t))
    return 'The risk score (0–10) combines four sources: CDC travel notices (40%), WHO/ReliefWeb outbreak alerts (30%), news sentiment (20%), and a base country safety index (10%). A score of 1–3 is low risk, 4–6 moderate, 7–9 high, and 10 extreme.';
  if (/cdc.*(level|notice|warning|alert)/.test(t))
    return 'CDC travel notice levels: Level 1 (Watch) — practice usual precautions. Level 2 (Alert) — enhanced precautions needed. Level 3 (Warning) — avoid non-essential travel. Level 3 adds the most weight to the risk score.';
  if (/who|reliefweb|outbreak/.test(t))
    return 'WHO outbreak data comes from ReliefWeb, which aggregates global health emergency reports. Recent outbreaks in your destination country raise the WHO component of the risk score.';
  if (/vaccin/.test(t))
    return 'Required and recommended vaccinations vary by country. Check the CDC destination page for specifics. Common travel vaccines include Hepatitis A/B, Typhoid, Yellow Fever, and routine MMR/Tdap boosters.';
  if (/travel.?plan|itinerary|plan/.test(t))
    return 'Tap "Travel plan" on the home screen. Enter your travel dates, transport type, and destinations. SafeTrax will save the plan and you can check risk scores for each destination.';
  if (/real.?time|track|location|gps/.test(t))
    return 'The "Real-time" screen uses your device GPS to fetch a live risk score for your current country. Your location is saved to your profile history and visible to friends you share with.';
  if (/emergency|contact|sos/.test(t))
    return 'Add an emergency contact in your Profile. If an incident occurs, your contact will have your last known location and travel plan details.';
  if (/friend|share|social/.test(t))
    return 'The Friends screen lets you see the real-time locations of people in your network. Tap a friend to view their current risk level and last update time.';
  if (/score.*mean|mean.*score|interpret/.test(t))
    return 'Score 1–3: low risk (green). Score 4–6: moderate (yellow/orange). Score 7–9: high risk (red). Score 10: extreme — consider cancelling travel.';
  if (/my.*(trip|plan|travel)|upcoming.*trip|where.*going/.test(t))
    return 'To see your trips, tap "Travel plan" in the bottom nav or go to the Trip History page. Your active plans are also shown on the home screen once you log in.';
  if (/sos|emergency.*button|send.*alert/.test(t))
    return 'The SOS screen lets you send an emergency alert with your GPS location. Tap "SOS" in the app to access it. If GPS is unavailable, the alert is still sent without coordinates.';
  if (/notification|alert.*bell|bell.*alert/.test(t))
    return 'The bell icon in the navigation bar shows your unread alert count. Tap it to see all notifications including risk alerts, friend updates, and trip reminders.';
  if (/safe|risk|dangerous|travel.*to|go.*to|visit/.test(t))
    return 'I can check risk scores for specific countries. Try asking "What is the risk score for Japan?" or tap Real-time on the home screen to see risk data for your current location.';
  return "I'm not sure about that one. You can ask me about risk scores, CDC/WHO alerts, vaccinations, travel plans, the SOS feature, or how SafeTrax works.";
}

app.post('/api/chat', async (req, res) => {
  const { messages, user_id } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const validMsgs = messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (validMsgs.length === 0) {
    return res.status(400).json({ error: 'No valid messages provided' });
  }

  // Build context-aware system prompt
  let system = SAFETRAX_SYSTEM;
  if (user_id) {
    try {
      const user = db.prepare('SELECT name, citizenship, health_concerns, emergency_contact_name FROM users WHERE id = ?').get(user_id);
      if (user) {
        const plans = db.prepare(`
          SELECT tp.date_start, tp.date_end, tp.transport, tp.status,
                 GROUP_CONCAT(d.city || ' (' || d.country_code || ')', ' → ') as route
          FROM travel_plans tp
          LEFT JOIN destinations d ON d.travel_plan_id = tp.id
          WHERE tp.user_id = ? AND tp.status = 'active'
          GROUP BY tp.id ORDER BY tp.date_start LIMIT 5
        `).all(user_id);
        const healthConcerns = (() => { try { return JSON.parse(user.health_concerns || '[]'); } catch { return []; } })();
        const planLines = plans.map(p => `  - ${p.route || 'No destinations'} (${p.date_start} to ${p.date_end}, ${p.transport || 'unspecified transport'})`).join('\n');
        system += `\n\nCurrent user context:\n- Name: ${user.name}\n- Citizenship: ${user.citizenship || 'unspecified'}\n- Health concerns: ${healthConcerns.length ? healthConcerns.join(', ') : 'none recorded'}\n- Emergency contact: ${user.emergency_contact_name || 'not set'}\n- Active travel plans:\n${planLines || '  (none)'}`;
      }
    } catch { /* ignore context errors */ }
  }

  // Rule-based fallback when no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    const lastUser = [...validMsgs].reverse().find(m => m.role === 'user');
    return res.json({ reply: ruleBasedReply(lastUser ? lastUser.content : '') });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages:   validMsgs,
    });

    const reply = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    res.json({ reply });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    const lastUser = [...validMsgs].reverse().find(m => m.role === 'user');
    res.json({ reply: ruleBasedReply(lastUser ? lastUser.content : '') });
  }
});

// ─── POST /api/users ─────────────────────────────────────────────────────────
app.post('/api/users', async (req, res) => {
  const u = req.body;
  if (!u.email || !u.name) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const plainPassword = u.password || u.password_hash;
  if (!plainPassword) return res.status(400).json({ error: 'password is required' });

  try {
    const hash = await bcrypt.hash(plainPassword, 10);
    const result = db.prepare(`
      INSERT INTO users
        (name, email, password_hash, dob, address, phone, citizenship,
         height_ft, weight_lbs, blood_type, race_ethnicity,
         health_concerns, health_other, vaccination_history, additional_note,
         emergency_contact_name, emergency_contact_phone,
         consent_signed, signature, consent_date,
         travel_frequency, travel_purpose, traveler_type, insurance_status, vaccination_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      u.name, u.email, hash,
      u.dob || null, u.address || null, u.phone || null, u.citizenship || null,
      u.height_ft  || null, u.weight_lbs  || null,
      u.blood_type || null, u.race_ethnicity || null,
      JSON.stringify(u.health_concerns || []),
      u.health_other || null, u.vaccination_history || null, u.additional_note || null,
      u.emergency_contact_name  || null, u.emergency_contact_phone || null,
      u.consent ? 1 : 0, u.signature || null, u.consent_date || null,
      u.travel_frequency || null,
      u.travel_purpose ? JSON.stringify(u.travel_purpose) : null,
      u.traveler_type || null,
      u.insurance_status != null ? (u.insurance_status ? 1 : 0) : 0,
      u.vaccination_status ? JSON.stringify(u.vaccination_status) : null,
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/login ─────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const row = db.prepare('SELECT id, name, email, citizenship, password_hash FROM users WHERE email = ?').get(email);
  if (!row) return res.status(401).json({ error: 'Invalid email or password' });

  // Dev bypass: seed data has placeholder hashes like $2b$10$abc1
  const isSeedHash = /^\$2b\$10\$abc/.test(row.password_hash);
  const valid = isSeedHash ? true : await bcrypt.compare(password, row.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare('INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?,?,?)').run(row.id, token, expiresAt);
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)').run(row.id, 'login', JSON.stringify({ method: 'email' }));

  res.json({ id: row.id, name: row.name, email: row.email, citizenship: row.citizenship, token });
});

// ─── POST /api/logout ────────────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  const token = req.body.token || req.headers['x-session-token'];
  if (token) db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// ─── GET /api/me ─────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  const token = req.query.token || req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'token required' });
  const session = db.prepare(`
    SELECT s.user_id, s.expires_at, u.name, u.email, u.citizenship
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  if (!session) return res.status(401).json({ error: 'session expired or invalid' });
  res.json({ id: session.user_id, name: session.name, email: session.email, citizenship: session.citizenship });
});

// ─── POST /api/travel-plans ──────────────────────────────────────────────────
app.post('/api/travel-plans', (req, res) => {
  const { user_id, date_start, date_end, transport, destinations, checklist } = req.body;
  if (!user_id || !date_start || !date_end) {
    return res.status(400).json({ error: 'user_id, date_start, date_end are required' });
  }

  const savePlan = db.transaction(() => {
    const plan = db.prepare(`
      INSERT INTO travel_plans (user_id, date_start, date_end, transport)
      VALUES (?,?,?,?)
    `).run(user_id, date_start, date_end, transport || null);

    const planId = plan.lastInsertRowid;

    const insertDest = db.prepare(`
      INSERT INTO destinations (travel_plan_id, seq, country_code, state_code, city)
      VALUES (?,?,?,?,?)
    `);
    (destinations || []).forEach((d, i) => {
      insertDest.run(planId, i + 1, d.country, d.state || null, d.city || null);
    });

    const insertCheck = db.prepare(`
      INSERT INTO plan_checklist (travel_plan_id, item_key, checked) VALUES (?,?,?)
    `);
    for (const [key, val] of Object.entries(checklist || {})) {
      insertCheck.run(planId, key, val ? 1 : 0);
    }

    return planId;
  });

  const planId = savePlan();
  res.status(201).json({ id: planId });
});

// ─── POST /api/locations ─────────────────────────────────────────────────────
app.post('/api/locations', (req, res) => {
  const { user_id, latitude, longitude, city, country_code, note } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  db.prepare(`
    INSERT INTO user_locations (user_id, latitude, longitude, city, country_code, note)
    VALUES (?,?,?,?,?,?)
  `).run(user_id, latitude || null, longitude || null, city || null, country_code || null, note || null);

  res.status(201).json({ ok: true });
});

// ─── GET /api/notifications ──────────────────────────────────────────────────
app.get('/api/notifications', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const items = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(user_id);
  const unread = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read=0`).get(user_id).c;
  res.json({ items, unread });
});

// ─── POST /api/notifications/read ────────────────────────────────────────────
app.post('/api/notifications/read', (req, res) => {
  const { user_id, notification_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (notification_id) {
    db.prepare(`UPDATE notifications SET read=1 WHERE id=? AND user_id=?`).run(notification_id, user_id);
  } else {
    db.prepare(`UPDATE notifications SET read=1 WHERE user_id=?`).run(user_id);
  }
  res.json({ ok: true });
});

// ─── GET /api/trips ───────────────────────────────────────────────────────────
app.get('/api/trips', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const plans = db.prepare(`
    SELECT tp.*, GROUP_CONCAT(d.city || ' (' || d.country_code || ')', ' → ') as route
    FROM travel_plans tp
    LEFT JOIN destinations d ON d.travel_plan_id = tp.id
    WHERE tp.user_id = ?
    GROUP BY tp.id
    ORDER BY tp.date_start DESC
  `).all(user_id);
  res.json({ plans });
});

// ─── POST /api/sos ────────────────────────────────────────────────────────────
app.post('/api/sos', (req, res) => {
  const { user_id, latitude, longitude, country_code, message } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const result = db.prepare(`
    INSERT INTO sos_events (user_id, latitude, longitude, country_code, message, status)
    VALUES (?,?,?,?,?,'active')
  `).run(user_id, latitude || null, longitude || null, country_code || null, message || 'SOS triggered');
  db.prepare(`
    INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)
  `).run(user_id, 'sos', JSON.stringify({ lat: latitude, lng: longitude, country: country_code }));
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, country_code)
    VALUES (?,?,?,?,?)
  `).run(user_id, 'system', '🆘 SOS Activated', 'Your emergency alert has been sent. Stay safe.', country_code || null);
  res.status(201).json({ id: result.lastInsertRowid, ok: true });
});

// ─── POST /api/risk-brief ─────────────────────────────────────────────────────
// Generates a 2-sentence AI risk brief for a destination using live DB data.
// Falls back to a template sentence if no API key.
app.post('/api/risk-brief', async (req, res) => {
  const { country_code, country_name } = req.body;
  if (!country_code) return res.status(400).json({ error: 'country_code required' });

  const cc = country_code.toUpperCase();

  // Gather live data from DB
  const cdcRows  = db.prepare(`SELECT title, alert_level FROM cdc_notices  WHERE country_code = ? ORDER BY alert_level DESC LIMIT 3`).all(cc);
  const whoRows  = db.prepare(`SELECT title, recency      FROM who_outbreaks WHERE country_code = ? ORDER BY published_at DESC LIMIT 3`).all(cc);
  const newsRows = db.prepare(`SELECT title               FROM news_items    WHERE country_code = ? ORDER BY fetched_at DESC LIMIT 3`).all(cc);
  const riskRow  = db.prepare(`SELECT score, cdc_component, who_component, news_component FROM risk_scores WHERE country_code = ? ORDER BY calculated_at DESC LIMIT 1`).get(cc);

  const score = riskRow ? riskRow.score : null;
  const label = score == null ? 'unknown' : score <= 3 ? 'low' : score <= 6 ? 'moderate' : score <= 9 ? 'high' : 'extreme';

  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback = score != null
      ? `${country_name || cc} has a ${label} risk score of ${score}/10 based on current CDC, WHO, and news data. ${cdcRows.length ? `CDC notice: ${cdcRows[0].title}.` : 'No active CDC notices.'}`
      : `No risk data cached for ${country_name || cc} yet. Search this destination to load live safety intelligence.`;
    return res.json({ brief: fallback, score, label });
  }

  try {
    const context = [
      score != null ? `Risk score: ${score}/10 (${label})` : 'Risk score: not yet calculated',
      cdcRows.length  ? `CDC notices: ${cdcRows.map(r => `Level ${r.alert_level} — ${r.title}`).join('; ')}` : 'CDC notices: none',
      whoRows.length  ? `WHO outbreaks: ${whoRows.map(r => `${r.title} (${r.recency})`).join('; ')}` : 'WHO outbreaks: none',
      newsRows.length ? `Recent news: ${newsRows.map(r => r.title).join('; ')}` : 'Recent news: none',
    ].join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system:     'You are a travel safety analyst. Write exactly 2 sentences: one summarizing the current risk level and why, one actionable recommendation. Plain text only, no markdown.',
      messages:   [{ role: 'user', content: `Write a 2-sentence risk brief for ${country_name || cc}:\n${context}` }],
    });
    const brief = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ brief, score, label });
  } catch (err) {
    console.error('[/api/risk-brief]', err.message);
    res.json({ brief: `${country_name || cc} currently has a ${label} risk level. Check CDC and WHO advisories before travel.`, score, label });
  }
});

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  try {
    const kpis = {
      totalUsers:       db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      activePlans:      db.prepare("SELECT COUNT(*) as c FROM travel_plans WHERE status='active'").get().c,
      completedPlans:   db.prepare("SELECT COUNT(*) as c FROM travel_plans WHERE status='completed'").get().c,
      totalPlans:       db.prepare('SELECT COUNT(*) as c FROM travel_plans').get().c,
      consentedUsers:   db.prepare('SELECT COUNT(*) as c FROM users WHERE consent_signed=1').get().c,
      countriesTracked: db.prepare('SELECT COUNT(DISTINCT country_code) as c FROM risk_scores').get().c,
      cdcAlerts:        db.prepare('SELECT COUNT(*) as c FROM cdc_notices').get().c,
      whoAlerts:        db.prepare('SELECT COUNT(*) as c FROM who_outbreaks').get().c,
      activeLocations:  db.prepare("SELECT COUNT(*) as c FROM user_locations WHERE updated_at > datetime('now','-24 hours')").get().c,
      sosEvents:        db.prepare('SELECT COUNT(*) as c FROM sos_events').get().c,
      insuredUsers:     db.prepare('SELECT COUNT(*) as c FROM users WHERE insurance_status=1').get().c,
    };
    const userGrowth = db.prepare(`SELECT DATE(created_at) as date, COUNT(*) as count FROM users WHERE created_at > datetime('now','-30 days') GROUP BY DATE(created_at) ORDER BY date`).all();
    const topDests   = db.prepare(`SELECT country_code, COUNT(*) as count FROM destinations GROUP BY country_code ORDER BY count DESC LIMIT 10`).all();
    const transport  = db.prepare(`SELECT transport, COUNT(*) as count FROM travel_plans WHERE transport IS NOT NULL GROUP BY transport ORDER BY count DESC`).all();
    const citizenships = db.prepare(`SELECT citizenship, COUNT(*) as count FROM users WHERE citizenship IS NOT NULL GROUP BY citizenship ORDER BY count DESC LIMIT 10`).all();
    const topRisks   = db.prepare(`SELECT country_code, score, calculated_at FROM risk_scores ORDER BY calculated_at DESC LIMIT 20`).all();
    // aggregate health concerns
    const hRows = db.prepare(`SELECT health_concerns FROM users WHERE health_concerns IS NOT NULL AND health_concerns != '[]'`).all();
    const healthCounts = {};
    for (const row of hRows) {
      try { for (const c of JSON.parse(row.health_concerns)) healthCounts[c] = (healthCounts[c]||0)+1; } catch {}
    }

    // Travel frequency distribution
    const freqRows = db.prepare(`SELECT travel_frequency, COUNT(*) as count FROM users WHERE travel_frequency IS NOT NULL GROUP BY travel_frequency ORDER BY count DESC`).all();

    // Traveler type distribution
    const travelerTypeRows = db.prepare(`SELECT traveler_type, COUNT(*) as count FROM users WHERE traveler_type IS NOT NULL GROUP BY traveler_type ORDER BY count DESC`).all();

    // Insurance coverage
    const insuredCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE insurance_status = 1`).get().c;

    // Travel purpose aggregation
    const purposeRows = db.prepare(`SELECT travel_purpose FROM users WHERE travel_purpose IS NOT NULL AND travel_purpose != '[]'`).all();
    const purposeCounts = {};
    for (const row of purposeRows) {
      try { for (const p of JSON.parse(row.travel_purpose)) purposeCounts[p] = (purposeCounts[p]||0)+1; } catch {}
    }

    // Vaccination coverage aggregation
    const vaccRows = db.prepare(`SELECT vaccination_status FROM users WHERE vaccination_status IS NOT NULL AND vaccination_status != '[]'`).all();
    const vaccCounts = {};
    for (const row of vaccRows) {
      try { for (const v of JSON.parse(row.vaccination_status)) vaccCounts[v] = (vaccCounts[v]||0)+1; } catch {}
    }

    // Age distribution
    const ageRows = db.prepare(`SELECT dob FROM users WHERE dob IS NOT NULL`).all();
    const ageBrackets = { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '55+': 0, 'unknown': 0 };
    for (const row of ageRows) {
      const age = new Date().getFullYear() - parseInt((row.dob || '').substring(0, 4));
      if (isNaN(age)) ageBrackets['unknown']++;
      else if (age <= 25) ageBrackets['18-25']++;
      else if (age <= 35) ageBrackets['26-35']++;
      else if (age <= 45) ageBrackets['36-45']++;
      else if (age <= 55) ageBrackets['46-55']++;
      else ageBrackets['55+']++;
    }

    // SOS events
    const sosTotal  = db.prepare(`SELECT COUNT(*) as c FROM sos_events`).get().c;
    const sosActive = db.prepare(`SELECT COUNT(*) as c FROM sos_events WHERE status='active'`).get().c;

    res.json({ kpis, userGrowth, topDests, transport, healthCounts, citizenships, topRisks,
               freqRows, travelerTypeRows, insuredCount, purposeCounts, vaccCounts, ageBrackets,
               sosTotal, sosActive });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/admin/users ────────────────────────────────────────────────────
app.get('/api/admin/users', (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const where  = search ? `WHERE (u.name LIKE ? OR u.email LIKE ? OR u.citizenship LIKE ?)` : '';
    const params = search ? [search, search, search] : [];
    const total  = db.prepare(`SELECT COUNT(*) as c FROM users u ${where}`).get(...params).c;
    const users  = db.prepare(`
      SELECT u.id, u.name, u.email, u.citizenship, u.blood_type, u.health_concerns,
             u.consent_signed, u.created_at,
             COUNT(tp.id) as plan_count, MAX(tp.date_start) as last_trip
      FROM users u LEFT JOIN travel_plans tp ON tp.user_id = u.id
      ${where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    res.json({ total, page, limit, users });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/admin/chat ────────────────────────────────────────────────────
app.post('/api/admin/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ reply: 'Admin AI analyst requires ANTHROPIC_API_KEY to be configured.' });
  try {
    const stats = {
      totalUsers:  db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      activePlans: db.prepare("SELECT COUNT(*) as c FROM travel_plans WHERE status='active'").get().c,
      cdcAlerts:   db.prepare('SELECT COUNT(*) as c FROM cdc_notices').get().c,
      whoAlerts:   db.prepare('SELECT COUNT(*) as c FROM who_outbreaks').get().c,
      topDests:    db.prepare('SELECT country_code, COUNT(*) as n FROM destinations GROUP BY country_code ORDER BY n DESC LIMIT 5').all(),
      recentRisks: db.prepare('SELECT country_code, score FROM risk_scores ORDER BY calculated_at DESC LIMIT 5').all(),
    };
    const system = `You are the SafeTrax Data Analyst, an AI assistant for SafeTrax administrators.\nSafeTrax is a travel health and safety app. Help admins interpret user data, identify trends, and make product decisions.\nYou have access to aggregated data including user registrations, travel plans, health concerns, and risk intelligence.\nBe specific, data-driven, and actionable. Keep answers concise.\n\nCurrent live database stats:\n${JSON.stringify(stats, null, 2)}`;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await anthropic.messages.create({
      model: 'claude-opus-4-6', max_tokens: 1024, system,
      messages: messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    });
    const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ reply, stats });
  } catch(err) { console.error('[/api/admin/chat]', err.message); res.status(500).json({ error: err.message }); }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SafeTrax API  →  http://localhost:${PORT}`);
  console.log(`News scoring  →  ${process.env.NEWS_API_KEY ? 'enabled (NewsAPI key set)' : 'disabled (set NEWS_API_KEY env var)'}`);
});
