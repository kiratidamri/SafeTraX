/**
 * SafeTrax Risk Scorer
 *
 * FORMULA
 * ───────────────────────────────────────────────────────────────────────────
 * score = clamp( 0.40×CDC + 0.30×WHO + 0.20×NEWS + 0.10×BASE , 0, 10 )
 *
 * where each component is an independent 0–10 score:
 *
 * CDC component  (weight 40%)
 *   Source: HTML scrape of https://wwwnc.cdc.gov/travel/notices  (no RSS — 404)
 *   Level 3 Warning = 10  |  Level 2 Alert = 6  |  Level 1 Watch = 3  |  None = 0
 *   +0.5 per additional notice for the same country (cap 10)
 *
 * WHO/Outbreak component  (weight 30%)
 *   Source: ReliefWeb RSS (UN humanitarian service, WHO partner)
 *   https://reliefweb.int/updates/rss.xml?search=outbreak+health+emergency
 *   WHO's own RSS feeds return 404 — confirmed dead as of 2025.
 *   Active entry (<30 days ago) = 8
 *   Recent entry (30–90 days ago) = 4
 *   Historical entry (90–180 days ago) = 1
 *   Nothing in 180 days = 0
 *   +0.5 per additional item (cap 10)
 *
 * NEWS component  (weight 20%)
 *   Source: NewsAPI  →  https://newsapi.org/v2/everything  (requires API key)
 *   n = negative-keyword articles in past 7 days mentioning the country
 *   NEWS = min(10, n × 1.5)
 *   Negative keywords: warning, danger, outbreak, attack, violence, crime,
 *                      disaster, emergency, killed, evacuation, threat, crisis
 *
 * BASE component  (weight 10%)
 *   Static safety baseline per country derived from Global Peace Index quartiles.
 *   Very safe (top 40): 1  |  Safe (41–80): 2  |  Moderate (81–120): 4
 *   Unsafe (121–160): 6   |  Very unsafe (161+): 8  |  Unknown: 5
 * ───────────────────────────────────────────────────────────────────────────
 */

'use strict';

// fetch is built-in from Node.js v18+
const { XMLParser } = require('fast-xml-parser');

const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

// ─── Static BASE scores (Global Peace Index-derived) ───────────────────────
const BASE_SCORES = {
  // Very safe (1)
  IS: 1, IE: 1, DK: 1, AT: 1, NZ: 1, SG: 1, PT: 1, NO: 1, FI: 1, JP: 1,
  // Safe (2)
  CH: 2, CA: 2, AU: 2, NL: 2, BE: 2, SE: 2, DE: 2, LU: 2, CZ: 2, SK: 2,
  // Moderate (4)
  US: 4, GB: 4, FR: 4, IT: 4, ES: 4, KR: 4, HU: 4, PL: 4, GR: 4, RO: 4,
  CN: 4, TH: 4, MY: 4, TW: 4, AR: 4, CL: 4, UY: 4, CR: 4, GH: 4, SN: 4,
  // Unsafe (6)
  TR: 6, IN: 6, BR: 6, MX: 6, ZA: 6, EG: 6, PH: 6, ID: 6, VN: 6, PE: 6,
  CO: 6, BO: 6, JO: 6, SA: 6, MA: 6, TN: 6, KE: 6, TZ: 6, ET: 6,
  // Very unsafe (8)
  NG: 8, PK: 8, VE: 8, UA: 8, CD: 8, SD: 8, ML: 8, NE: 8, CF: 8, LY: 8,
  IQ: 8, IR: 8, KP: 8, HT: 8, SO: 8,
  // Extreme (9)
  AF: 9, SY: 9, YE: 9, SS: 9,
};

// ─── Country name → ISO code (for RSS text matching) ───────────────────────
const NAME_TO_CODE = {
  'united states': 'US', 'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'france': 'FR', 'germany': 'DE', 'italy': 'IT', 'spain': 'ES',
  'china': 'CN', 'japan': 'JP', 'india': 'IN', 'brazil': 'BR',
  'mexico': 'MX', 'canada': 'CA', 'australia': 'AU', 'new zealand': 'NZ',
  'afghanistan': 'AF', 'syria': 'SY', 'yemen': 'YE', 'somalia': 'SO',
  'iraq': 'IQ', 'south sudan': 'SS', 'ukraine': 'UA', 'russia': 'RU',
  'nigeria': 'NG', 'pakistan': 'PK', 'venezuela': 'VE', 'egypt': 'EG',
  'thailand': 'TH', 'philippines': 'PH', 'south africa': 'ZA',
  'democratic republic of the congo': 'CD', 'drc': 'CD', 'congo': 'CD',
  'sudan': 'SD', 'mali': 'ML', 'niger': 'NE', 'central african republic': 'CF',
  'libya': 'LY', 'turkey': 'TR', 'indonesia': 'ID', 'malaysia': 'MY',
  'vietnam': 'VN', 'cambodia': 'KH', 'laos': 'LA', 'myanmar': 'MM',
  'kenya': 'KE', 'ethiopia': 'ET', 'tanzania': 'TZ', 'ghana': 'GH',
  'senegal': 'SN', 'ivory coast': 'CI', 'colombia': 'CO', 'peru': 'PE',
  'argentina': 'AR', 'chile': 'CL', 'saudi arabia': 'SA', 'iran': 'IR',
  'israel': 'IL', 'jordan': 'JO', 'lebanon': 'LB', 'morocco': 'MA',
  'tunisia': 'TN', 'algeria': 'DZ', 'singapore': 'SG', 'south korea': 'KR',
  'taiwan': 'TW', 'hong kong': 'HK', 'portugal': 'PT', 'netherlands': 'NL',
  'belgium': 'BE', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
  'finland': 'FI', 'poland': 'PL', 'czechia': 'CZ', 'czech republic': 'CZ',
  'hungary': 'HU', 'greece': 'GR', 'austria': 'AT', 'switzerland': 'CH',
  'ireland': 'IE', 'haiti': 'HT', 'north korea': 'KP',
};

// ─── Code → display name ────────────────────────────────────────────────────
const CODE_TO_NAME = Object.entries(NAME_TO_CODE).reduce((acc, [name, code]) => {
  if (!acc[code]) acc[code] = name.replace(/\b\w/g, c => c.toUpperCase());
  return acc;
}, {});

function getCountryName(code) {
  return CODE_TO_NAME[code.toUpperCase()] || code;
}

// ─── Text-based country matching ────────────────────────────────────────────
// Uses whole-word matching only — never substring on 2-letter codes (e.g. "NG"
// would falsely match "meNGococcal"). Only country names and known aliases are
// checked as whole words.
function matchesCountry(text, code) {
  const t = text.toLowerCase();
  // Check every known name/alias that maps to this code
  for (const [alias, c] of Object.entries(NAME_TO_CODE)) {
    if (c !== code) continue;
    // Whole-word boundary check (handles multi-word names like "south sudan")
    const re = new RegExp('(?:^|[\\s,;:(\\[])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\s,;:)\\].]|$)', 'i');
    if (re.test(t)) return true;
  }
  return false;
}

// ─── Fetch CDC notices via HTML scrape ───────────────────────────────────────
// CDC removed their RSS feed. We scrape the live notices page instead.
// URL: https://wwwnc.cdc.gov/travel/notices
async function fetchCDCNotices(countryCode) {
  const res = await fetch('https://wwwnc.cdc.gov/travel/notices', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SafeTrax-RiskScorer/1.0)',
      'Accept': 'text/html',
    },
    timeout: 12000,
  });
  const html = await res.text();

  // The page groups notices under h2/h3 headers "Level 1 / 2 / 3 – ..."
  // Each notice is an <a> tag whose href starts with /travel/notices/
  // We collect all anchor hrefs that appear after a "Level X" heading
  const notices = [];
  let currentLevel = 1;

  // Split by tags to walk through content linearly
  const tagRe = /<[^>]+>|[^<]+/g;
  let tokens = html.match(tagRe) || [];
  let lastText = '';

  for (const token of tokens) {
    if (token.startsWith('<')) {
      // Check if this tag is a heading containing "Level X"
      const levelMatch = lastText.match(/Level\s+([123])/i);
      if (levelMatch) currentLevel = parseInt(levelMatch[1], 10);

      // Check if this is an <a href="/travel/notices/...">
      const hrefMatch = token.match(/href=["']([^"']*\/travel\/notices\/[^"']+)["']/i);
      if (hrefMatch) {
        // The title text will follow this tag — grab it
        const titleIdx = tokens.indexOf(token);
        let title = '';
        for (let i = titleIdx + 1; i < Math.min(titleIdx + 6, tokens.length); i++) {
          if (!tokens[i].startsWith('<') && tokens[i].trim()) {
            title = tokens[i].trim().replace(/&amp;/g, '&').replace(/&ndash;/g, '–');
            break;
          }
        }
        if (!title || title.toLowerCase().includes('read more')) continue;

        const isGlobal = title.toLowerCase().includes('global') || title.toLowerCase().includes('worldwide');
        if (!isGlobal && !matchesCountry(title, countryCode)) continue;

        notices.push({
          title,
          level: currentLevel,
          url: hrefMatch[1].startsWith('http') ? hrefMatch[1] : 'https://wwwnc.cdc.gov' + hrefMatch[1],
          published_at: '',
        });
      }
      lastText = '';
    } else {
      lastText = token;
    }
  }

  // Deduplicate by title
  const seen = new Set();
  return notices.filter(n => {
    if (seen.has(n.title)) return false;
    seen.add(n.title);
    return true;
  });
}

// ─── Fetch outbreak data via ReliefWeb RSS ────────────────────────────────────
// WHO's own RSS feeds return 404 (confirmed dead).
// ReliefWeb is the UN's humanitarian information platform (partners with WHO).
// URL: https://reliefweb.int/updates/rss.xml?search=outbreak+health+emergency
async function fetchWHOOutbreaks(countryCode) {
  const url = 'https://reliefweb.int/updates/rss.xml?search=outbreak+health+emergency';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SafeTrax-RiskScorer/1.0', 'Accept': 'application/rss+xml' },
    timeout: 12000,
  });
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(xml);
  const raw = parsed?.rss?.channel?.item || [];
  const items = Array.isArray(raw) ? raw : [raw];

  const now = Date.now();
  const outbreaks = [];

  for (const item of items) {
    const title = String(item.title || '');
    // ReliefWeb embeds "Country: XYZ" inside the HTML description
    const desc  = String(item.description || '').replace(/<[^>]+>/g, ' ');
    const text  = title + ' ' + desc;

    if (!matchesCountry(text, countryCode)) continue;

    const pubMs = item.pubDate ? new Date(String(item.pubDate)).getTime() : 0;
    const daysAgo = (now - pubMs) / 86400000;
    if (daysAgo > 180) continue;

    const recency = daysAgo < 30 ? 'active' : daysAgo < 90 ? 'recent' : 'historical';

    outbreaks.push({
      title,
      recency,
      url: String(item.link || ''),
      published_at: String(item.pubDate || ''),
    });
  }
  return outbreaks;
}

// ─── Fetch negative news via NewsAPI ────────────────────────────────────────
const NEGATIVE_KW = [
  'warning', 'danger', 'outbreak', 'attack', 'violence', 'crime',
  'disaster', 'emergency', 'killed', 'evacuation', 'threat', 'crisis',
  'epidemic', 'pandemic', 'unrest', 'conflict', 'avoid', 'unsafe',
];

function isNegative(text) {
  const t = text.toLowerCase();
  return NEGATIVE_KW.some(k => t.includes(k));
}

async function fetchNews(countryCode) {
  if (!NEWS_API_KEY) return [];
  const countryName = getCountryName(countryCode);
  const query = `"${countryName}" AND (travel warning OR outbreak OR safety risk OR violence OR disaster OR health emergency)`;
  const from  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&sortBy=relevancy&pageSize=20&language=en&apiKey=${NEWS_API_KEY}`;

  const res  = await fetch(url, { timeout: 10000 });
  const data = await res.json();
  if (!data.articles) return [];

  return data.articles
    .filter(a => isNegative((a.title || '') + ' ' + (a.description || '')))
    .map(a => ({
      title:        a.title        || '',
      description:  a.description  || '',
      source:       a.source?.name || '',
      url:          a.url          || '',
      published_at: a.publishedAt  || '',
    }));
}

// ─── Component scorers ───────────────────────────────────────────────────────
function scoreCDC(notices) {
  if (!notices.length) return 0;
  const levelMap = { 3: 10, 2: 6, 1: 3 };
  const maxLevel = Math.max(...notices.map(n => n.level));
  const base = levelMap[maxLevel] || 0;
  const bonus = Math.min(2, (notices.length - 1) * 0.5);
  return Math.min(10, base + bonus);
}

function scoreWHO(outbreaks) {
  if (!outbreaks.length) return 0;
  const recencyMap = { active: 8, recent: 4, historical: 1 };
  const maxScore = Math.max(...outbreaks.map(o => recencyMap[o.recency] || 0));
  const bonus = Math.min(2, (outbreaks.length - 1) * 0.5);
  return Math.min(10, maxScore + bonus);
}

function scoreNews(articles) {
  return Math.min(10, articles.length * 1.5);
}

function scoreBase(countryCode) {
  return BASE_SCORES[countryCode.toUpperCase()] ?? 5;
}

// ─── Global feed (no country filter) ─────────────────────────────────────────
// Used by GET /api/news to populate the homepage newsfeed even with an empty DB.

async function fetchCDCAllNotices() {
  const res = await fetch('https://wwwnc.cdc.gov/travel/notices', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SafeTrax-RiskScorer/1.0)',
      'Accept': 'text/html',
    },
    timeout: 12000,
  });
  const html = await res.text();
  const notices = [];
  let currentLevel = 1;

  const tagRe = /<[^>]+>|[^<]+/g;
  const tokens = html.match(tagRe) || [];
  let lastText = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('<')) {
      const levelMatch = lastText.match(/Level\s+([123])/i);
      if (levelMatch) currentLevel = parseInt(levelMatch[1], 10);

      const hrefMatch = token.match(/href=["']([^"']*\/travel\/notices\/[^"']+)["']/i);
      if (hrefMatch) {
        let title = '';
        for (let j = i + 1; j < Math.min(i + 6, tokens.length); j++) {
          if (!tokens[j].startsWith('<') && tokens[j].trim()) {
            title = tokens[j].trim().replace(/&amp;/g, '&').replace(/&ndash;/g, '–');
            break;
          }
        }
        if (!title || title.toLowerCase().includes('read more')) { lastText = ''; continue; }
        notices.push({
          source: 'CDC',
          title,
          level: currentLevel,
          url: hrefMatch[1].startsWith('http') ? hrefMatch[1] : 'https://wwwnc.cdc.gov' + hrefMatch[1],
          published_at: '',
          country_code: null,
        });
      }
      lastText = '';
    } else {
      lastText = token;
    }
  }
  const seen = new Set();
  return notices.filter(n => { if (seen.has(n.title)) return false; seen.add(n.title); return true; });
}

async function fetchWHOAllOutbreaks() {
  const url = 'https://reliefweb.int/updates/rss.xml?search=outbreak+health+emergency';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SafeTrax-RiskScorer/1.0', 'Accept': 'application/rss+xml' },
    timeout: 12000,
  });
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(xml);
  const raw = parsed?.rss?.channel?.item || [];
  const items = Array.isArray(raw) ? raw : [raw];

  const now = Date.now();
  return items
    .filter(item => {
      const pubMs = item.pubDate ? new Date(String(item.pubDate)).getTime() : 0;
      return (now - pubMs) / 86400000 <= 180;
    })
    .map(item => {
      const pubMs = item.pubDate ? new Date(String(item.pubDate)).getTime() : 0;
      const daysAgo = (now - pubMs) / 86400000;
      return {
        source: 'WHO',
        title: String(item.title || ''),
        recency: daysAgo < 30 ? 'active' : daysAgo < 90 ? 'recent' : 'historical',
        url: String(item.link || ''),
        published_at: String(item.pubDate || ''),
        country_code: null,
      };
    });
}

async function fetchGlobalNews() {
  if (!NEWS_API_KEY) return [];
  const query = 'travel warning OR health outbreak OR disease emergency OR natural disaster OR safety alert';
  const from  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&sortBy=publishedAt&pageSize=30&language=en&apiKey=${NEWS_API_KEY}`;
  const res  = await fetch(url, { timeout: 10000 });
  const data = await res.json();
  if (!data.articles) return [];
  return data.articles
    .filter(a => isNegative((a.title || '') + ' ' + (a.description || '')))
    .map(a => ({
      source: a.source?.name || 'News',
      title: a.title || '',
      description: a.description || '',
      url: a.url || '',
      published_at: a.publishedAt || '',
      country_code: null,
    }));
}

async function fetchGlobalFeed() {
  const [cdcResult, whoResult, newsResult] = await Promise.allSettled([
    fetchCDCAllNotices(),
    fetchWHOAllOutbreaks(),
    fetchGlobalNews(),
  ]);
  const cdc  = cdcResult.status  === 'fulfilled' ? cdcResult.value  : [];
  const who  = whoResult.status  === 'fulfilled' ? whoResult.value  : [];
  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
  return [...cdc, ...who, ...news];
}

// ─── Main export ─────────────────────────────────────────────────────────────
async function fetchRiskData({ country }) {
  const code = country.toUpperCase();

  // Fetch all three sources in parallel; fail gracefully if one is down
  const [cdcResult, whoResult, newsResult] = await Promise.allSettled([
    fetchCDCNotices(code),
    fetchWHOOutbreaks(code),
    fetchNews(code),
  ]);

  const cdcNotices  = cdcResult.status  === 'fulfilled' ? cdcResult.value  : [];
  const whoOutbreaks = whoResult.status === 'fulfilled' ? whoResult.value  : [];
  const newsArticles = newsResult.status === 'fulfilled' ? newsResult.value : [];

  const cdcComp  = scoreCDC(cdcNotices);
  const whoComp  = scoreWHO(whoOutbreaks);
  const newsComp = scoreNews(newsArticles);
  const baseComp = scoreBase(code);

  /*
   * FORMULA:
   *   score = clamp( 0.40×CDC + 0.30×WHO + 0.20×NEWS + 0.10×BASE , 0, 10 )
   */
  const raw   = 0.40 * cdcComp + 0.30 * whoComp + 0.20 * newsComp + 0.10 * baseComp;
  const score = Math.min(10, Math.max(0, parseFloat(raw.toFixed(1))));

  return {
    score,
    breakdown: {
      cdc:  cdcComp,
      who:  whoComp,
      news: newsComp,
      base: baseComp,
    },
    formula: {
      expression: 'score = clamp(0.40×CDC + 0.30×WHO + 0.20×NEWS + 0.10×BASE, 0, 10)',
      weights: { cdc: 0.40, who: 0.30, news: 0.20, base: 0.10 },
      raw_components: { cdc: cdcComp, who: whoComp, news: newsComp, base: baseComp },
    },
    sources: {
      cdc_notices:    cdcNotices,
      who_outbreaks:  whoOutbreaks,
      news_items:     newsArticles.slice(0, 5),
    },
    errors: {
      cdc:  cdcResult.status  === 'rejected' ? cdcResult.reason?.message  : null,
      who:  whoResult.status  === 'rejected' ? whoResult.reason?.message  : null,
      news: newsResult.status === 'rejected' ? newsResult.reason?.message : null,
    },
  };
}

module.exports = { fetchRiskData, fetchGlobalFeed, getCountryName };
