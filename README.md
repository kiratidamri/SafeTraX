# SafeTrax

A mobile-first travel safety web app that gives travelers real-time risk intelligence, AI-powered recommendations, and health/safety tools — all in one place. Built with Node.js, SQLite, and Claude AI.

---

## Features

### For Travelers
- **Secure auth** — bcrypt password hashing, session tokens, 30-day sessions
- **Travel plan builder** — multi-destination with country/state/city selectors, hotel & accommodation info, flight details (airline, flight number, airports), pre-trip checklist
- **AI risk recommendations** — per-destination risk scores (0–10) pulled from CDC notices, WHO outbreaks, and news feeds; 2-sentence AI brief per country
- **Real-time risk dashboard** — live weather, food/water/air safety, civil unrest, and disaster alerts on a map
- **AI chatbot** — context-aware assistant (Claude Haiku) that knows your active travel plans, citizenship, and health profile
- **SOS alert** — one-tap emergency broadcast with GPS coordinates
- **Trip history** — full archive of past and active plans with hotel/flight details
- **Notifications** — in-app alert feed

### For Admins
- **Overview dashboard** — 8 KPI cards, 10 charts (user growth, top destinations, transport modes, health concerns, age distribution, travel frequency, traveler type, travel purpose, vaccination coverage, top airlines)
- **Travel Plans table** — all plans with traveler info, route, hotel, flight, status; searchable & paginated
- **Users table** — searchable/paginated user registry with health tags, consent status, plan count
- **Risk Intel** — country risk scores from the live database
- **AI Analyst** — Claude-powered chat trained on live database stats for trend analysis

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v22+ |
| Server | Express 4 |
| Database | SQLite (node:sqlite built-in, WAL mode) |
| Auth | bcryptjs + crypto session tokens |
| AI | Anthropic Claude (Haiku for user chat/risk briefs, Opus for admin analyst) |
| Maps | MapLibre GL JS |
| Charts | Chart.js 4 |
| Geocoding | Nominatim (OpenStreetMap) |
| Risk feeds | CDC Travel Notices RSS, WHO Disease Outbreak News RSS, NewsAPI |
| Frontend | Vanilla HTML/CSS/JS, Inter font, mobile-first |

---

## Project Structure

```
safetrax/
├── backend/
│   ├── server.js          # Express API + all endpoints
│   ├── riskScorer.js      # CDC / WHO / NewsAPI feed fetcher
│   ├── package.json
│   ├── Dockerfile
│   └── public/            # Static frontend (served by Express)
│       ├── index.html         # Home / login
│       ├── signup.html        # Registration
│       ├── travel-plan.html   # Trip builder
│       ├── recommendation.html# Risk recommendations + map
│       ├── realtime.html      # Real-time safety dashboard
│       ├── sos.html           # SOS alert
│       ├── history.html       # Trip history
│       ├── profile.html       # User profile
│       ├── profile-edit.html  # Edit profile
│       ├── notifications.html # Alerts
│       ├── friends.html       # Contacts
│       ├── faq.html           # Help / FAQ
│       ├── admin.html         # Admin dashboard
│       └── styles.css         # Shared design system
└── database/
    ├── schema.sql         # Table definitions
    └── safetrax.db        # SQLite database (gitignored)
```

---

## Getting Started

### Prerequisites
- Node.js v22 or later
- An [Anthropic API key](https://console.anthropic.com/) for AI features
- (Optional) A [NewsAPI key](https://newsapi.org/) for news-based risk scoring

### Installation

```bash
git clone https://github.com/kiratidamri/SafeTraX.git
cd SafeTraX/backend
npm install
```

### Environment Variables

Create `backend/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
NEWS_API_KEY=your_newsapi_key   # optional — risk scoring works without it
PORT=3000                        # optional — defaults to 3000
```

### Run

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Visit `http://localhost:3000`

Admin dashboard: `http://localhost:3000/admin.html`

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/users` | Register a new user |
| POST | `/api/login` | Authenticate → returns session token |
| POST | `/api/logout` | Invalidate session token |
| GET | `/api/me` | Validate token, return user profile |
| POST | `/api/travel-plans` | Save a travel plan with destinations, hotel, flight |
| GET | `/api/trips` | User's trip history with full destination details |
| POST | `/api/locations` | Log real-time location |
| POST | `/api/chat` | AI chatbot with user travel context |
| POST | `/api/sos` | Trigger SOS alert |
| GET | `/api/risk` | Risk score for a country/region |
| POST | `/api/risk-brief` | AI 2-sentence risk brief for a country |
| GET | `/api/notifications` | User notification feed |
| POST | `/api/notifications/read` | Mark notifications read |
| GET | `/api/admin/stats` | Aggregated dashboard statistics |
| GET | `/api/admin/users` | Paginated/searchable user list |
| GET | `/api/admin/plans` | Paginated/searchable travel plans list |
| POST | `/api/admin/chat` | Admin AI analyst (Claude Opus) |

---

## Docker

```bash
cd backend
docker build -t safetrax .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NEWS_API_KEY=your_key \
  safetrax
```

---

## Seed Data

The database schema includes seed users for development. Seed accounts use placeholder password hashes and accept **any password** in development mode. Real registered users require the correct password.

Seed accounts (any password works):
- `alice@example.com`
- `bob@example.com`
- `carol@example.com`

---

## License

MIT
