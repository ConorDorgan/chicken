# Find the Chicken: Game Spec

A mobile-first web app for a real-world pub hunt. One player (the **chicken**) hides in a pub. **Teams** search the pubs, and each wrong pub costs them a pint. The game ends when the last team finds the chicken.

## Roles

| Role | Access | Job |
|---|---|---|
| **Admin** | Single admin password | **Before the game only.** Manages the master pub list and settings, creates games and gets the codes. The admin also plays, so admin screens **never** show the chicken's pub, location, or find status. |
| **Chicken** | Secret chicken code per game | Picks their pub, starts the hunt, runs the live game as referee. |
| **Team** | Shared team code + team name, one phone per team | Hunts, checks in, proves pints, claims finds. |

There are no user accounts. Logins are codes per game, plus the admin password.

## Setup (admin)

1. Manage the **master pub list**: add a pub by searching or dropping a map pin, and delete pubs.
2. Set the **settings**:
   - Head-start length (e.g. 15 min)
   - Minimum pint timer (e.g. 15 min)
   - "Nearby" radius for alerts
   - "Left early" distance (e.g. 100 m)
   - Zone auto-shrink interval (e.g. 30 min) and shrink factor (e.g. 60%)
3. **New game**: choose which pubs are in play tonight. The site generates a **chicken code** (secret) and a **team code** (shared, with a QR code).
4. Delete old games and their photos.

## Game flow

1. The chicken enters the chicken code and **chooses their own pub** from tonight's list. It is stored secretly.
2. Teams join with the team code and a team name.
3. The chicken taps **Start**. Teams see a **head-start countdown** and can't check in until it ends.
4. The hunt runs (below). **There is no deadline.**
5. The game **ends when the last team is confirmed as finding the chicken.** That team is the loser.

## Hunting loop (team)

- **Check in (outside):** the team taps **"Check in at [pub]"** and must take a **photo of the pub from the outside**, using the camera live rather than an upload from the gallery. The photo, GPS and time are recorded. This proves they are there. Every pub visit starts this way, including the chicken's pub.
- The team then goes inside and either finds the chicken or doesn't.
- **No chicken there:** the team taps "No chicken here" and is **locked** ("Drink up"). To leave they need **both**:
  - a **photo of the empty pints**, taken as they leave (camera only), and
  - the **minimum pint timer** elapsed, counted from the outside check-in photo.
- **Chicken spotted:** the team taps **"Found the chicken"** (after checking in outside). The claim goes to the chicken:
  - **Confirm:** the team gets their finishing position and switches to the "You're in, wait for the rest" screen (with a feed of other teams' pint photos).
  - **Reject:** "The chicken says no 🐔❌". The claim is logged, the pub counts as checked with no chicken, the team is locked, and they owe a pint.
  - **No response:** the claim stays **Pending** and the team waits. Claims are never auto-confirmed.

## Location and alerts

- A plain website cannot track in the background. **GPS updates only while a team has the app open**, plus at every check-in, photo upload and claim.
- The chicken sees **"last active X min ago"** for each team.
- **"Team nearby"** alert to the chicken when a team's update lands within the nearby radius of the chicken's pub.
- **"Team X left early!"** alert to the chicken when a locked team's update is beyond the left-early distance from their pub.
  - **No in-game penalty.** It goes on the team's record and shows in the recap.
- Chicken alerts use web push plus sound and vibration. On iPhone this needs the app added to the home screen.

## Shrinking zone

- At the start, the circle covers all pubs in play.
- Each shrink makes a smaller circle that **always contains the chicken's pub but is randomly offset** (the pub is never at the centre).
- **Pubs outside the zone are greyed out** on the teams' map.
- **Auto-shrink** on the admin-set interval and factor, with a countdown shown to teams.
- **Chicken "Shrink now" button**, which also resets the auto countdown.
- **Floor:** the zone stops shrinking when about 2–3 pubs remain inside it.
- Every shrink sends a "🔴 The zone has shrunk!" notification to all teams.

## Clues

- The chicken sends **free-text clues** at any time.
- Clues are broadcast to **all teams** at once, as a notification plus a clue feed.
- All clues appear in the recap.

## Screens

**Chicken (live)**
- Map with all team positions and last-active times
- Pending claims pinned at the top, with confirm or reject
- Alerts feed (nearby, left early)
- Photo feed (outside check-in photos and empty-pint photos)
- Send a clue, Shrink now
- Fix-it tools: remove a team, undo a wrong find, end the game

**Team**
- Map and pub list showing: ✅ checked by us, 🍺 here and locked (with timer), ⬜ not checked, greyed out if outside the zone
- Status: Hunting, Locked, or Found
- Zone countdown
- Clue feed
- "X of N teams have found the chicken"
- **Never shown:** other teams' positions or other teams' checked pubs

**Admin**
- Pub list, settings, games, codes. Nothing about the live game state.

## End-of-game recap (shareable link)

- Reveal of the chicken's pub on the map
- Finishing order with times. The last team is the loser.
- Each team's route, pubs in order, and pints drunk
- Hall of shame: early-leaving alerts, longest time inactive, slowest pint, rejected claims
- Photo wall: every outside check-in photo and empty-pint photo
- Stats: total pints, most pubs checked, fastest find
- All clues sent

## Tech

- **Frontend:** Next.js (React), mobile-first and installable to the home screen, hosted on **Vercel**.
- **Backend:** **Supabase**, which provides the Postgres database, realtime (chicken map, alerts, zone, clues), storage (check-in and pint photos) and row-level security.
- **Secrecy:** the chicken's pub and team locations are readable only with the chicken code. They are revealed to everyone at game end. This is honour-level: anyone with database access could still look.
- **Maps:** Leaflet + OpenStreetMap, with no API key.
- **Push:** Web Push to the chicken (and teams, for zone and clue notifications).
- **Needed from the owner:** Vercel and Supabase accounts and project keys.
