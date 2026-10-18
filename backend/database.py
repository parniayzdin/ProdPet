# database.py — db connection stuff
# loads .env, builds the sqlalchemy (tiger postgres or local sqlite),
# creates tables on startup if they dont exist yet.
# tiger hands you postgres:// urls; sqlalchemy wants postgresql:// so we rewrite that.

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./prodpet.db"
# tiger gives postgres:// usallu and sqlalchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://") :]

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # Import models so metadata is registered before create_all.
    from models import ActivityEvent, FocusSession, PresenceEvent 

    Base.metadata.create_all(bind=engine)


def is_postgres() -> bool:
    return engine.dialect.name == "postgresql"
