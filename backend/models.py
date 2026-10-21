# models.py — tables + request and response shapes
# sqlalchemy models = what we store (sessions, activity_events, presence_events)
# pydantic models = what the api takes in / sends out
# also has the point scoring

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base

FOCUS_DURATIONS = {300, 900, 1500, 3000}  # 300 is the short friends race.
QUEST_DURATIONS = {300, 900, 1500}
QUEST_BONUSES = {300: 25, 900: 75, 1500: 150}

# Robot Gemini "bad" habits → negative points (applied once per check id).
HABIT_PENALTIES = {
    "phone": -50,
    "posture": -25,
    "distracted": -40,
    "tired": -15,
    "stressed": -20,
    "long_session": -30,
}
HABIT_REASONS = set(HABIT_PENALTIES)


class FocusSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    base: Mapped[int] = mapped_column(Integer, nullable=False)
    bonus: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    # TimescaleDB: every unique index must include the time column
    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, nullable=False
    )
    session_id: Mapped[str] = mapped_column(String(36), primary_key=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    focus_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)


class PresenceEvent(Base):
    # little ticks while youre focusing

    __tablename__ = "presence_events"

    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, nullable=False
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    present: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)


class SessionCreate(BaseModel):
    id: uuid.UUID
    task: str = Field(min_length=1, max_length=120)
    date: datetime
    seconds: int
    duration: int
    mode: Literal["focus", "quest"] = "focus"

    @field_validator("date")
    @classmethod
    def require_aware_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("date must be timezone-aware (include an offset or Z)")
        return value.astimezone(timezone.utc)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    task: str
    date: datetime
    seconds: int
    duration: int
    mode: str
    base: int
    bonus: int
    total: int


class DailyStat(BaseModel):
    date: str
    focus_minutes: int
    points: int


class UserStats(BaseModel):
    user_id: uuid.UUID
    total_points: int
    completed_sessions: int
    total_focused_minutes: int
    daily: list[DailyStat]


class PresenceCreate(BaseModel):
    session_id: uuid.UUID | None = None
    present: bool = True
    source: Literal["timer", "vision"] = "timer"


class PresenceOut(BaseModel):
    id: uuid.UUID
    time: datetime
    user_id: uuid.UUID
    session_id: uuid.UUID | None
    present: bool
    source: str


class FocusQualityOut(BaseModel):
    user_id: uuid.UUID
    session_id: uuid.UUID | None
    present_ticks: int
    total_ticks: int
    at_desk_percent: float


class PenaltyCreate(BaseModel):
    id: uuid.UUID
    reason: Literal[
        "phone", "posture", "distracted", "tired", "stressed", "long_session"
    ]
    confidence: float = Field(default=1.0, ge=0, le=1)
    tip: str = Field(default="", max_length=240)
    session_id: uuid.UUID | None = None


class PenaltyOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    reason: str
    points: int
    tip: str
    time: datetime


def penalty_points_for(reason: str) -> int:
    return HABIT_PENALTIES.get(reason, -25)


def score_session(seconds: int, mode: str, duration: int) -> tuple[int, int, int]:
    base = (seconds // 60) * 10
    bonus = 0
    if mode == "quest" and seconds >= duration:
        bonus = QUEST_BONUSES.get(duration, 0)
    return base, bonus, base + bonus


def validate_session_durations(mode: str, duration: int, seconds: int) -> None:
    allowed = FOCUS_DURATIONS if mode == "focus" else QUEST_DURATIONS
    if duration not in allowed:
        raise ValueError(
            f"duration {duration} is not allowed for mode {mode}; "
            f"allowed: {sorted(allowed)}"
        )
    if seconds < 60 or seconds > duration:
        raise ValueError(
            f"seconds must be between 60 and duration ({duration}), got {seconds}"
        )
