# ChessNest — Integrated starter project

A GitHub-ready **starter implementation**, not a verified production release. Built from the recovered ChessNest frontend prototype, the user's Supabase column export, and consolidated backend additions.

## Includes

- Original frontend prototype in `public/index.html` (still uses local demo state; not connected to API)
- Node.js / Express backend, JWT HTTP-only cookie authentication, bcrypt password hashing
- Supabase PostgreSQL pool, migration for custom authentication
- Match creation, join by ID, match history, legal move submission using `chess.js` and row locking
- Lesson and exercise endpoints, lesson completion, progress, heuristic match coaching summary

## Run

1. Install Node.js 20+ and run `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a **long random** `JWT_SECRET`.
3. Run `sql/001_custom_auth.sql` in Supabase SQL Editor after checking for duplicate usernames and duplicate progress rows. **Do not put your database password in GitHub.**
4. Run `npm run check` and `npm run dev`.
5. Open `http://localhost:3000`.

## API

`GET /api/health`; `POST /api/auth/signup` `{email,username,password}`; `POST /api/auth/login` `{email,password}`; `POST /api/auth/logout`; `GET /api/auth/me`.

`GET /api/matches`; `POST /api/matches` `{game_type:'system'|'online'}`; `GET /api/matches/:id`; `POST /api/matches/:id/join`; `POST /api/matches/:id/moves` `{move:'e2e4'}`.

Also see `src/routes/extra-routes.js` for lessons, exercises, learning progress and combined coaching.

## Important limitations

- The recovered frontend is a **demo prototype** and does not yet call the API. Its local signup is not the secure backend signup.
- The system opponent does not automatically generate moves. Use online matches with two users to test both sides.
- Online matchmaking, realtime sockets, forgot-password email, and a production deployment are **not implemented**.
- Existing Supabase tables are required. Only an incremental migration is provided, not a destructive rebuild.
- Backend source from older messages was not recoverable as files; this is a **new compact implementation**, not a restoration or verification of 114 routes.
- Run with a real test database and review migration before production. A GitHub push is possible without completing deployment.
