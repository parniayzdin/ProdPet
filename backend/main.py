# main.py — the actual API
# frontend runs the timer so we just save finished sessions, give back stats,
# take presence ticks, and apply habit penalties from the desk robot.

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_current_user_id
from database import get_db, init_db, is_postgres
from models import (
    ActivityEvent,
    DailyStat,
    FocusQualityOut,
    FocusSession,
    PenaltyCreate,
    PenaltyOut,
    PresenceCreate,
    PresenceEvent,
    PresenceOut,
    SessionCreate,
    SessionOut,
    UserStats,
    penalty_points_for,
    score_session,
    validate_session_durations,
)

app = FastAPI(title="ProdPet API", version="0.1.0")

# Local Vite + optional FRONTEND_ORIGIN (comma-separated) for Vultr / production.
_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
_cors_origins.extend(
    o.strip()
    for o in (os.getenv("FRONTEND_ORIGIN") or "").split(",")
    if o.strip()
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _canonical_match(
    existing: FocusSession, data: SessionCreate, user_id: UUID
) -> bool:
    return (
        existing.user_id == str(user_id)
        and existing.task == data.task
        and _as_utc(existing.date) == data.date
        and existing.seconds == data.seconds
        and existing.duration == data.duration
        and existing.mode == data.mode
    )


def _to_out(row: FocusSession) -> SessionOut:
    return SessionOut(
        id=UUID(row.id),
        user_id=UUID(row.user_id),
        task=row.task,
        date=_as_utc(row.date),
        seconds=row.seconds,
        duration=row.duration,
        mode=row.mode,
        base=row.base,
        bonus=row.bonus,
        total=row.total,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sessions", response_model=SessionOut)
def create_session(
    data: SessionCreate,
    response: Response,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    try:
        validate_session_durations(data.mode, data.duration, data.seconds)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    session_id = str(data.id)
    existing = db.get(FocusSession, session_id)
    if existing is not None:
        if _canonical_match(existing, data, user_id):
            response.status_code = 200
            return _to_out(existing)
        raise HTTPException(
            status_code=409,
            detail="session id already exists with different data",
        )

    base, bonus, total = score_session(data.seconds, data.mode, data.duration)
    now = datetime.now(timezone.utc)
    uid = str(user_id)

    row = FocusSession(
        id=session_id,
        user_id=uid,
        task=data.task,
        date=data.date,
        seconds=data.seconds,
        duration=data.duration,
        mode=data.mode,
        base=base,
        bonus=bonus,
        total=total,
        created_at=now,
    )
    event = ActivityEvent(
        time=data.date,
        session_id=session_id,
        user_id=uid,
        event_type="session_completed",
        focus_seconds=data.seconds,
        points=total,
    )

    try:
        db.add(row)
        db.add(event)
        db.commit()
    except IntegrityError:
        db.rollback()
        raced = db.get(FocusSession, session_id)
        if raced is not None and _canonical_match(raced, data, user_id):
            response.status_code = 200
            return _to_out(raced)
        raise HTTPException(
            status_code=409,
            detail="session id already exists with different data",
        ) from None

    db.refresh(row)
    response.status_code = 201
    return _to_out(row)


@app.get("/users/{user_id}/sessions", response_model=list[SessionOut])
def list_sessions(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user_id: UUID = Depends(get_current_user_id),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="forbidden")
    rows = db.scalars(
        select(FocusSession)
        .where(FocusSession.user_id == str(user_id))
        .order_by(FocusSession.date.desc())
    ).all()
    return [_to_out(row) for row in rows]


@app.get("/users/{user_id}/stats", response_model=UserStats)
def user_stats(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user_id: UUID = Depends(get_current_user_id),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="forbidden")
    uid = str(user_id)

    totals = db.execute(
        select(
            func.coalesce(func.sum(FocusSession.total), 0),
            func.count(FocusSession.id),
            func.coalesce(func.sum(FocusSession.seconds), 0),
        ).where(FocusSession.user_id == uid)
    ).one()
    penalty_total = db.execute(
        select(func.coalesce(func.sum(ActivityEvent.points), 0)).where(
            ActivityEvent.user_id == uid,
            ActivityEvent.event_type.like("habit_penalty%"),
        )
    ).scalar_one()
    # Session points + negative habit penalties; never show below zero.
    total_points = max(0, int(totals[0]) + int(penalty_total))
    completed_sessions = int(totals[1])
    total_focused_minutes = int(totals[2]) // 60

    now = datetime.now(timezone.utc)
    # Inclusive 7-day window starting at UTC midnight 6 days ago.
    start = (now - timedelta(days=6)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(days=7)

    daily_map: dict[str, DailyStat] = {}
    for offset in range(7):
        day = (start + timedelta(days=offset)).date().isoformat()
        daily_map[day] = DailyStat(date=day, focus_minutes=0, points=0)

    if is_postgres():
        # Real Tiger Data / TimescaleDB aggregation path.
        result = db.execute(
            text(
                """
                SELECT
                    time_bucket('1 day', time) AS bucket,
                    COALESCE(
                        SUM(CASE WHEN event_type = 'session_completed'
                            THEN focus_seconds ELSE 0 END),
                        0
                    ) AS focus_seconds,
                    COALESCE(SUM(points), 0) AS points
                FROM activity_events
                WHERE user_id = :user_id
                  AND (
                        event_type = 'session_completed'
                        OR event_type LIKE 'habit_penalty%'
                      )
                  AND time >= :start
                  AND time < :end
                GROUP BY bucket
                ORDER BY bucket
                """
            ),
            {"user_id": uid, "start": start, "end": end},
        )
        for bucket, focus_seconds, points in result:
            day = _as_utc(bucket).date().isoformat()
            if day in daily_map:
                daily_map[day] = DailyStat(
                    date=day,
                    focus_minutes=int(focus_seconds) // 60,
                    points=int(points),
                )
    else:
        sqlite_start = start.strftime("%Y-%m-%d %H:%M:%S.%f")
        sqlite_end = end.strftime("%Y-%m-%d %H:%M:%S.%f")
        result = db.execute(
            text(
                """
                SELECT
                    strftime('%Y-%m-%d', time) AS day,
                    COALESCE(
                        SUM(CASE WHEN event_type = 'session_completed'
                            THEN focus_seconds ELSE 0 END),
                        0
                    ) AS focus_seconds,
                    COALESCE(SUM(points), 0) AS points
                FROM activity_events
                WHERE user_id = :user_id
                  AND (
                        event_type = 'session_completed'
                        OR event_type LIKE 'habit_penalty%'
                      )
                  AND time >= :start
                  AND time < :end
                GROUP BY day
                ORDER BY day
                """
            ),
            {"user_id": uid, "start": sqlite_start, "end": sqlite_end},
        )
        for day, focus_seconds, points in result:
            if day in daily_map:
                daily_map[day] = DailyStat(
                    date=day,
                    focus_minutes=int(focus_seconds) // 60,
                    points=int(points),
                )

    return UserStats(
        user_id=user_id,
        total_points=total_points,
        completed_sessions=completed_sessions,
        total_focused_minutes=total_focused_minutes,
        daily=[daily_map[k] for k in sorted(daily_map.keys())],
    )


@app.post("/penalties", response_model=PenaltyOut)
def create_penalty(
    data: PenaltyCreate,
    response: Response,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    # Desk robot saw a bad habit (phone, posture, …) → negative points.
    # session_id column holds the client penalty id so the same check isn't fined twice.
    uid = str(user_id)
    event_id = str(data.id)

    def _penalty_out(row: ActivityEvent, tip: str = "") -> PenaltyOut:
        parts = row.event_type.split(":", 1)
        reason = parts[1] if len(parts) == 2 else data.reason
        return PenaltyOut(
            id=UUID(row.session_id),
            user_id=user_id,
            reason=reason,
            points=row.points,
            tip=tip,
            time=_as_utc(row.time),
        )

    existing = db.scalars(
        select(ActivityEvent).where(
            ActivityEvent.session_id == event_id,
            ActivityEvent.user_id == uid,
            ActivityEvent.event_type.like("habit_penalty%"),
        )
    ).first()
    if existing is not None:
        response.status_code = 200
        return _penalty_out(existing, data.tip)

    now = datetime.now(timezone.utc)
    points = penalty_points_for(data.reason)
    event = ActivityEvent(
        time=now,
        session_id=event_id,
        user_id=uid,
        event_type=f"habit_penalty:{data.reason}",
        focus_seconds=0,
        points=points,
    )
    try:
        db.add(event)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalars(
            select(ActivityEvent).where(
                ActivityEvent.session_id == event_id,
                ActivityEvent.user_id == uid,
            )
        ).first()
        if existing is None:
            raise
        response.status_code = 200
        return _penalty_out(existing, data.tip)

    response.status_code = 201
    return PenaltyOut(
        id=data.id,
        user_id=user_id,
        reason=data.reason,
        points=points,
        tip=data.tip,
        time=now,
    )


@app.post("/presence", response_model=PresenceOut, status_code=201)
def create_presence(
    data: PresenceCreate,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    now = datetime.now(timezone.utc)
    event_id = uuid4()
    row = PresenceEvent(
        time=now,
        id=str(event_id),
        user_id=str(user_id),
        session_id=str(data.session_id) if data.session_id else None,
        present=data.present,
        source=data.source,
    )
    db.add(row)
    db.commit()
    return PresenceOut(
        id=event_id,
        time=now,
        user_id=user_id,
        session_id=data.session_id,
        present=data.present,
        source=data.source,
    )


@app.get("/users/{user_id}/focus-quality", response_model=FocusQualityOut)
def focus_quality(
    user_id: UUID,
    session_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user_id: UUID = Depends(get_current_user_id),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="forbidden")
    uid = str(user_id)

    query = select(
        func.coalesce(func.sum(cast(PresenceEvent.present, Integer)), 0),
        func.count(PresenceEvent.id),
    ).where(PresenceEvent.user_id == uid)
    if session_id is not None:
        query = query.where(PresenceEvent.session_id == str(session_id))

    present_ticks, total_ticks = db.execute(query).one()
    present_ticks = int(present_ticks)
    total_ticks = int(total_ticks)
    percent = (
        round(100.0 * present_ticks / total_ticks, 1) if total_ticks else 0.0
    )
    return FocusQualityOut(
        user_id=user_id,
        session_id=session_id,
        present_ticks=present_ticks,
        total_ticks=total_ticks,
        at_desk_percent=percent,
    )
