-- setup_timescale.sql — one-time tiger / timescale setup.
-- run this AFTER the api has created the normal tables (start uvicorn once).
-- turns activity_events + presence_events into hypertables, and builds a
-- daily_presence continuous aggregate so we can show off time_bucket stuff.
-- note: hypertables want `time` in every unique index / pk (we already did that).

-- Completed-session event stream
SELECT create_hypertable(
    'activity_events',
    by_range('time'),
    migrate_data => TRUE,
    if_not_exists => TRUE
);

-- High-frequency desk presence ticks (timer / vision)
SELECT create_hypertable(
    'presence_events',
    by_range('time'),
    migrate_data => TRUE,
    if_not_exists => TRUE
);

-- Continuous aggregate: daily presence ticks per user (Timescale showcase)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_presence
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS day,
    user_id,
    COUNT(*) FILTER (WHERE present) AS present_ticks,
    COUNT(*) AS total_ticks
FROM presence_events
GROUP BY 1, 2
WITH NO DATA;

-- Refresh recent data every minute; keep ~30 days warm.
SELECT add_continuous_aggregate_policy(
    'daily_presence',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);
