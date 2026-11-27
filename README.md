# Find the Chicken 🐔

A pub hunt web app. See [SPEC.md](SPEC.md) for the rules and design.

## One-time setup

### 1. Supabase
1. **Turn on anonymous sign-ins:** Authentication → Sign In / Providers → **Allow anonymous sign-ins** → Save.
   Every phone gets an invisible anonymous session; game codes and the admin password attach roles to it.
2. **Create the database:** open `supabase/schema.sql`, change `change-me-please` (last lines) to your admin password,
   then paste the whole file into **SQL Editor → Run**.
   ⚠️ Re-running it wipes all games and pubs. Only re-run it when an update asks you to.

### Updates to an existing database
If you set the database up before an update below, run its file once in **SQL Editor → Run**. These keep all your pubs and games.

| File | What it adds |
|---|---|
| `supabase/002_team_players.sql` | Team player names, and GPS recorded from the moment a team joins |

### 2. Vercel
Import the repo and set these environment variables (Settings → Environment Variables):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |

Framework preset: **Next.js** (auto-detected). Then redeploy.

## Running a game
1. **Admin** (`/admin`): add pubs, check settings, **Create game**. You get a team code and a chicken code.
2. Give the **chicken code** privately to the chicken; share the **team link** with everyone.
3. The chicken picks a pub and taps **Start**. Teams wait out the head start, then hunt.
4. When the last team is confirmed, everyone lands on the recap page.

Tip: add the site to your home screen (Share → Add to Home Screen) for full-screen and notifications.

## Local development
```bash
cp .env.example .env.local   # fill in the two values
npm install
npm run dev
```
