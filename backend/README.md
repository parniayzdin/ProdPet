# ProdPet Rails API

Ruby on Rails 8.1 stores completed study sessions, scores quests, records robot
penalties and presence ticks, and returns dashboard statistics. Python still runs
OpenCV, YuNet and Gemini in `robot.py`.

The API has the same URLs and response fields as the previous FastAPI backend.
The existing dashboard's Supabase mode calls Rails through `VITE_API_URL`.
The default local-account mode still uses the Node server for progress and races.

## Start Rails

Install Ruby 3.4 with Bundler. On Windows, use
[RubyInstaller with Devkit](https://rubyinstaller.org/downloads/) and a terminal
where `ruby -v` and `bundle -v` work.

From the repository root:

```sh
cd backend
bundle install
ruby bin/rails db:prepare
ruby bin/rails server -b 127.0.0.1 -p 8000
```

Open http://127.0.0.1:8000/health. It returns `{"status":"ok"}`.
SQLite is the default and needs no database installation. `db:prepare` creates
`backend/prodpet.db` and applies migrations. The `ruby bin/rails` form also works
on Windows.

## Connect the dashboard

Copy the root `.env.example` to `.env` and set:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_API_URL=http://127.0.0.1:8000
```

Rails uses `SUPABASE_ANON_KEY` when set, otherwise `VITE_SUPABASE_ANON_KEY`.
It validates each bearer token with Supabase's `/auth/v1/user` endpoint, including
tokens signed with legacy or rotated keys. No JWT secret or service-role key is
needed. Supabase outages return 503; invalid tokens return 401.
User IDs always come from the verified account, never the request body.

Keep Rails running. From the repository root, run `npm ci`, `npm start`,
and in another terminal `npm run dev`. Open Vite's printed URL and sign in
with a Supabase account. Save at least one minute of a study session to see
the request reach Rails. The Node server continues to run accounts/friend races.

Leaving Supabase values blank keeps the original local Node mode; that mode
does **not** call Rails. Rails tests and the console below work without Supabase.

## Learn the Rails code

Follow one saved session through these files:

1. `config/routes.rb` maps `POST /sessions` to `SessionsController#create`.
2. `app/controllers/application_controller.rb` verifies the bearer token.
3. `app/controllers/sessions_controller.rb` validates the request and saves a
   session and its activity event in one transaction.
4. `app/models/focus_session.rb` validates durations and calculates points.
5. `app/services/user_statistics.rb` aggregates the seven UTC calendar days.

Try the model without an account or camera:

```sh
ruby bin/rails console
```

```ruby
session = FocusSession.new(
  id: SecureRandom.uuid,
  user_id: SecureRandom.uuid,
  task: "Learn Rails",
  date: Time.current,
  seconds: 900,
  duration: 900,
  mode: "quest"
)
session.valid?   # true; validation also calculates the score
session.total   # 225 = 150 base points + 75 quest bonus
session.seconds = 899
session.valid?
session.total   # 140; an unfinished quest earns no bonus
```

This console example does not save anything. Use the API for normal writes so
the session and activity event are always created together.

A useful first exercise: add a new quest duration, update `QUEST_BONUSES`,
and add an assertion in `test/integration/session_api_test.rb`.

## Endpoints

All routes except health require `Authorization: Bearer <supabase_access_token>`.

| Method | Path | Result |
| --- | --- | --- |
| GET | /health | Health check |
| POST | /sessions | Save and score a completed session |
| GET | /users/:user_id/sessions | Own sessions, newest first |
| GET | /users/:user_id/stats | Own totals and seven daily buckets |
| POST | /penalties | Record a robot habit penalty |
| POST | /presence | Record a timer/vision presence tick |
| GET | /users/:user_id/focus-quality | Presence percentage; optional session_id query |

Session JSON:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "task": "Learn Rails",
  "date": "2026-10-26T15:00:00Z",
  "seconds": 900,
  "duration": 900,
  "mode": "quest"
}
```

- Session IDs and user IDs are UUIDs; dates must include a timezone.
- The server ignores submitted `base`, `bonus`, `total` and `user_id`.
- Each whole minute earns 10 points. Completed quests add 25/75/150 points
  for 300/900/1500 seconds. Focus permits 300/900/1500/3000 seconds without a bonus.
- Sessions must be at least 60 seconds and no longer than their chosen duration.
- A new session returns 201. An identical retry returns 200 with no new points.
  Reusing its ID with different data or another user returns 409.
- Habit penalties: phone -50, posture -25, distracted -40, tired -15,
  stressed -20, long_session -30. A repeated penalty ID for the same user returns
  the original result. A database uniqueness constraint prevents duplicate charges.
- Cumulative points are clamped to zero; a daily bucket may be negative.
- Presence retains the old timer/vision contract. The existing dashboard labels
  timer-derived data as **Timer activity**; it is not proof of camera presence.

## Database migration

Back up an existing database, stop FastAPI, then run `ruby bin/rails db:migrate`
against that database. SQLite's existing `backend/prodpet.db` is reused by default.
The migration adopts existing `sessions`, `activity_events` and `presence_events`
tables without dropping or rebuilding them, and adds `penalty_receipts` for atomic
retry protection. Old penalties are recognized on retry.

For PostgreSQL or Tiger Cloud:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```

Plain PostgreSQL works; TimescaleDB is optional. Existing Timescale hypertables
are retained. New installations do not need `setup_timescale.sql`; Rails owns
schema creation. Daily aggregation uses UTC on both adapters.
Do not run FastAPI and Rails writers simultaneously during migration.
The adoption migration deliberately has no destructive rollback; restore the
backup to reverse it. Local Node accounts/progress are separate and are not migrated.

## Tests

```sh
ruby bin/rails test
ruby bin/rails zeitwerk:check
```

Tests use an isolated SQLite file in `backend/tmp`, never `DATABASE_URL` or
values from `.env`. They cover HTTP routes, scoring, input validation, UTC
boundaries, privacy, retries, transaction rollback, CORS and Supabase verification.
Authentication requests are stubbed at the network boundary in tests.
CI also runs the API suite against PostgreSQL via `TEST_DATABASE_URL`.

## Hosting

Build from the repository root:

```sh
docker build -f backend/Dockerfile -t prodpet-api .
```

Supply `RAILS_ENV=production`, `SECRET_KEY_BASE` (generate with
`ruby bin/rails secret`), `SUPABASE_URL`, the publishable key,
`FRONTEND_ORIGIN`, and optionally `DATABASE_URL`.
Set `API_HOSTS` to a comma-separated list of public hostnames if restricting hosts.
Use HTTPS at the reverse proxy and set the dashboard's `VITE_API_URL` to the
API's HTTPS origin before building it. The container runs migrations before Puma.
Persist `/app/backend/storage` when using production SQLite.
The existing Vultr compose file hosts the Node dashboard; host this API separately
when enabling Supabase mode.
