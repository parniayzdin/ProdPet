# ProdPet API

Simple FastAPI backend for completed focus sessions. The frontend owns the timer; this API only stores completed sessions, recalculates points, and returns stats.

## Setup

```sh
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Without `DATABASE_URL`, the API uses a local SQLite file (`prodpet.db`).

Copy the repo-root `.env.example` to `.env` and set:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
VITE_API_URL=http://127.0.0.1:8000
DATABASE_URL=postgresql://... # Tiger Cloud (postgres:// also works; normalized automatically)
```


Protected routes require `Authorization: Bearer <supabase_access_token>`.
`user_id` always comes from the JWT `sub` claim


## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/sessions` | Save a completed session |
| `GET` | `/users/{user_id}/sessions` | List sessions |
| `GET` | `/users/{user_id}/stats` | Totals + last 7 days (includes habit penalties) |
| `POST` | `/penalties` | Apply a robot habit penalty (phone, posture, …) |

### Habit penalties (desk robot)

While `python robot.py` is running, the dashboard polls `http://127.0.0.1:8765/checks`. Bad Gemini hits during an active focus session are posted to `POST /penalties`:

| reason | points |
|--------|--------|
| phone | -50 |
| distracted | -40 |
| long_session | -30 |
| posture | -25 |
| stressed | -20 |
| tired | -15 |

Same penalty `id` is ignored on retry (idempotent). Total points never go below 0.



## Scoring

- Base: `floor(seconds / 60) * 10`
- Quest bonus only if `seconds >= duration`: `300→25`, `900→75`, `1500→150`
- Focus mode: no bonus
- Allowed durations: focus `900/1500/3000`, quest `300/900/1500`
- Client `base` / `bonus` / `total` are ignored

## Merged dashboard setup

Use Node 22+ and Python 3.10+. Start the API above, then run `npm start` and `npm run dev` from the repository root. The root `.env` is read by Vite, Node, and the Python API. Configure both frontend Supabase values to enable email login. Restart all processes after changing settings. Node uses `SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to verify accounts for friend races; the race membership token is separate. Without cloud settings, the app uses local Node accounts and progress instead.

The default API accepts localhost ports 5173, 5174, and 4173. For a hosted frontend set `FRONTEND_ORIGIN` to its exact HTTPS origin and `VITE_API_URL` to the hosted API URL before building. Never put a service-role key or database password in a `VITE_` variable. Existing local accounts are not automatically migrated to Supabase.

Five-minute race results use focus mode with a 300-second duration and no quest bonus. Stable UUIDs prevent duplicate race awards. Robot penalties require the Python bridge and cloud mode; local mode shows feedback without applying penalties. Hardware remains optional.

Run backend checks with `pip install -r requirements-test.txt` then `python -m unittest test_stats_sqlite test_integration`. These use temporary SQLite databases, not Tiger Cloud. The `DATABASE_URL` adapter selects psycopg 3 for Tiger/Postgres URLs.
