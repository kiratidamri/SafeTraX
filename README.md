# SafeTraX

Mobile-first HTML app for travelers: login, sign up, travel plans, risk recommendations, and real-time status. Theme: Arial font, blue color scheme. CSS is in `styles.css`.

## Pages

1. **index.html** – Log in (email/password) or “Sign up with government”; after login: Travel plan, History, Profile, Notifications; temperature, CDC/WHO newsfeed, to-do list.
2. **signup.html** – Full registration: name, DOB, address, phone, email, password, emergency contact, citizenship, height/weight, blood type, race, health concerns (10+ other), vaccination history, additional note, consent & digital signature with date.
3. **travel-plan.html** – Destinations (US states + international), dates, primary transportation, checklist (immigration, health, law, weather). “Generate recommendation” links to recommendation page.
4. **recommendation.html** – Overall risk score (0–10) and breakdown by sub-regions (within 100 miles); risk scale legend; map placeholder for Google Maps; links to CDC, WHO, local government; verify checklist; partner recommendations (vaccines, car, hospitals, drug stores); real-time notifications (every 2 hours) and button to open real-time dashboard.
5. **realtime.html** – Current risk score, real-time weather, concerns (food, water, air/noise pollution, unrest, disasters), edit info for real-time situations, share with family/friends/government.

## Run locally

Open `index.html` in a browser, or use a local server:

```bash
# Python
python3 -m http.server 8000

# Node (npx)
npx serve .
```

Then visit `http://localhost:8000` (or the port shown).

## Google Maps

The recommendation page has a placeholder for a map. To integrate Google Maps with risk scores by sub-region, add the Maps JavaScript API and replace the `#map-container` content with a map instance; use your own API key and keep it in environment variables, not in the repo.

## Notes

- No backend: forms submit via GET or post to `index.html`; implement a server/API for real auth and data.
- Notifications and live risk/weather are UI-only; connect to your backend or third-party APIs for real data.
