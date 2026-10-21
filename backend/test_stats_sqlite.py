# test_stats_sqlite.py — quick local check for the stats bug we hit.
# sqlite was dropping sessions that landed exactly on the first day of the
# 7-day window (date compare / iso string weirdness). this spins up a throwaway
# db, drops a session on that boundary, and makes sure /stats still counts it.

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

# engine gets built on import, so set DATABASE_URL before pulling in app stuff
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"

from database import SessionLocal, init_db  # noqa: E402
from main import user_stats  # noqa: E402
from models import ActivityEvent, FocusSession, score_session  # noqa: E402


class SqliteStatsBoundaryTest(unittest.TestCase):
    def test_stats_includes_first_day_of_window(self):
        init_db()
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            start = (now - timedelta(days=6)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            # Midnight UTC on the first day of the window (the fragile boundary).
            session_time = start
            user_id = uuid4()
            session_id = uuid4()
            seconds, duration, mode = 900, 900, "focus"
            base, bonus, total = score_session(seconds, mode, duration)

            db.add(
                FocusSession(
                    id=str(session_id),
                    user_id=str(user_id),
                    task="Boundary check",
                    date=session_time,
                    seconds=seconds,
                    duration=duration,
                    mode=mode,
                    base=base,
                    bonus=bonus,
                    total=total,
                    created_at=now,
                )
            )
            db.add(
                ActivityEvent(
                    time=session_time,
                    session_id=str(session_id),
                    user_id=str(user_id),
                    event_type="session_completed",
                    focus_seconds=seconds,
                    points=total,
                )
            )
            db.commit()

            stats = user_stats(UUID(str(user_id)), db, UUID(str(user_id)))
            first_day = start.date().isoformat()
            day_stat = next(d for d in stats.daily if d.date == first_day)

            self.assertEqual(day_stat.focus_minutes, 15)
            self.assertEqual(day_stat.points, 150)
            self.assertEqual(stats.completed_sessions, 1)
            self.assertEqual(stats.total_points, 150)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
