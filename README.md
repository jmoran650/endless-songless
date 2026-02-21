# endless-songless

## Deployment Quickstart

This repo is now wired for a single-process deployment where the backend serves the built frontend.

1. Install dependencies at repo root:
   - `npm install`
2. Create env files:
   - `cp server/.env.example server/.env`
   - `cp client/.env.example client/.env`
3. Fill required server env values in `server/.env`:
   - `SUPABASE_DB_URL` (or `DATABASE_URL`)
   - `JWT_SECRET`
   - `CLIENT_URL` and/or `CORS_ORIGIN` with your public domain
4. If frontend and backend are on different domains, set `VITE_API_URL` in `client/.env`.
5. Build and run:
   - `npm run build`
   - `npm start`

### Production behavior

- `npm start` runs in production mode and serves the Vite bundle from `client/dist`.
- API routes remain under `/api/*`, sockets under `/socket.io/*`, and frontend routes fall back to `index.html`.
- CORS and websocket origin checks are locked to `CORS_ORIGIN` / `CLIENT_URL` (or same-origin-only when unset in production).
- Set `SERVE_CLIENT=false` only when serving the frontend from a separate host/CDN.

## Supabase Migration Acceptance Criteria

This section is the source of truth for the Supabase migration scope and release gate.

### Acceptance Table

| Area | Status | Evidence |
| --- | --- | --- |
| Project/config baseline | Complete | `supabase --version` returned `2.75.0`; linked project ref exists in `supabase/.temp/project-ref` (`wbapjeeqsbaibsrojwyz`); `supabase migration list --linked` confirmed local/remote migration history visibility. |
| Database migration (Supabase-native schema) | Complete | Added `supabase/migrations/20260221153000_supabase_native_port.sql` with native tables for `users`, `auth_sessions`, `score_entries`, `achievements`, `game_rooms`, `game_room_players`, plus Prisma-to-SQL data backfill blocks for `"User"`, `"AuthSession"`, `"ScoreEntry"`, `"Achievement"`. |
| Constraints/indexes/history correctness | Complete | Migration includes explicit constraints, FK references, trigger-managed `updated_at`, composite/partial indexes for auth session lookup and leaderboard reads, and timestamped migration file for deterministic history ordering. |
| API/data parity | Complete | Migrated backend data layer to SQL while preserving endpoint contracts for `/api/users/register`, `/api/users/login`, `/api/users/me`, `/api/leaderboard` (read/write), `/api/rooms` (`create/join/start/guess/skip/leave/state`), and `/api/audio/next`, `/api/audio/stream/:trackId`. Room operations now require authenticated bearer tokens to enforce host authorization and cross-user isolation. Verified via deep end-to-end suite (`8/8` passing) against local Supabase DB after reset to latest migration. |
| Security and RLS | Complete | Added RLS + `FORCE ROW LEVEL SECURITY` policies for sensitive/public tables in `20260221153000_supabase_native_port.sql`; backend request context sets `songless.user_id` and `songless.backend` via `server/src/db.js`; service-role credentials are server-side only; room host-action spoofing fixed by requiring authenticated room operations; auth responses no longer expose password hashes. |
| Performance & reliability | Complete | Connection pooling and bounded timeouts are implemented in `server/src/db.js`; indexes follow Supabase Postgres best-practice guidance for join/filter columns; structured observability added for auth, room ops, and streaming failures in server routes. |
| Release readiness docs | Complete | Migration, rollback, and recovery plan documented below; dry-run verification commands listed in release runbook, with local reset + API test verification captured in this table. |
| Success path + rollback path verified | Complete | Success path verified with `supabase db push --linked --dry-run` and actual apply via `supabase db push --linked` (remote now includes `20260221153000` per `supabase migration list --linked`); isolated local execution `supabase db reset --local` validated latest migration behavior. Rollback path verified via isolated local reset to previous version `supabase db reset --local --version 20260221031940`. |

## Migration Runbook

### Success Path

1. Confirm linked project and migration visibility:
   - `supabase migration list --linked`
2. Validate migration plan without applying:
   - `supabase db push --linked --dry-run`
3. Apply migration:
   - `supabase db push --linked`
4. Smoke API endpoints against deployed backend:
   - `GET /api/users/me` (with token)
   - `GET /api/leaderboard`
   - `POST /api/rooms`, `POST /api/rooms/:code/join`, `POST /api/rooms/:code/start`
   - `GET /api/audio/next`, `GET /api/audio/stream/:trackId`

### Rollback Path

1. Pause client traffic to writes (`/api/users/register`, `/api/leaderboard`, `/api/rooms/*`).
2. Restore pre-migration DB snapshot using Supabase backups/PITR.
3. Re-deploy backend commit prior to SQL migration and SQL data layer.
4. Re-run smoke checks on the pre-migration backend.
5. Keep migrated build available as a hotfix branch for forward re-apply after incident review.

### Recovery Plan (if rollback is not required)

1. Keep backend running with connection pool limits and statement timeouts from `server/src/db.js`.
2. Use `pg_stat_statements` on the Supabase instance to identify regressions in:
   - auth session lookups,
   - leaderboard reads/writes,
   - room lifecycle write hotspots.
3. Add targeted index or policy optimizations in a follow-up migration only (do not edit applied migration files).
