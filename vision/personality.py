"""
BunBun dialogue via Gemini, with hardcoded fallbacks if the API is unavailable.

Loads GEMINI_API_KEY from the project .env (or the environment).
Call only on meaningful events — never every video frame.
"""

from __future__ import annotations

import os
import random
from pathlib import Path

from dotenv import load_dotenv

# Project root .env (sibling of vision/)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Free-tier friendly Flash model (multimodal later in Step 5)
MODEL_NAME = "gemini-3.5-flash-lite"
# API requires at least 10s when a deadline is set manually
REQUEST_TIMEOUT_MS = 15000

FALLBACKS = {
    "arrived": [
        "Ohhh, you're back!",
        "Hey! Missed that face.",
        "Look who showed up!",
    ],
    "left": [
        "Okayyy, I'll nap. See you soon!",
        "Bye for now. Don't be a stranger.",
        "Going already? I'll keep the seat warm.",
    ],
    "snapshot": [
        "Hmm, my eyes glazed over for a sec.",
        "Still here. I'm watching… mostly.",
        "Desk check complete. Carry on!",
    ],
}

PERSONALITY = """
You are BunBun, a tiny desk companion robot.
Personality: cute, playful, slightly dramatic and humorous, caring but never judgmental.
Speak in one or two short conversational sentences.
No emojis. No quotes around your reply. No lists. No explaining yourself.
Do not assume the user is productive or unproductive from presence alone.
""".strip()


def _fallback(event: str) -> str:
    options = FALLBACKS.get(event, FALLBACKS["arrived"])
    return random.choice(options)


def _build_prompt(event: str, minutes_present: float | None) -> str:
    if event == "arrived":
        situation = "The person just sat down or came back into view."
    elif event == "left":
        situation = "The person just left the desk."
        if minutes_present is not None and minutes_present > 0:
            situation += f" They were present for about {minutes_present:.0f} minutes."
    else:
        situation = f"Event: {event}."

    return (
        f"{PERSONALITY}\n\n"
        f"Situation: {situation}\n"
        f"Reply with only the spoken line BunBun would say out loud."
    )


def _clean_line(text: str | None, event: str) -> str:
    text = (text or "").strip().strip('"').strip("'")
    if not text:
        return _fallback(event)
    if len(text) > 160:
        text = text[:157].rsplit(" ", 1)[0] + "…"
    return text


def _client():
    from google import genai
    from google.genai import types

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )


def line_for_event(event: str, minutes_present: float | None = None) -> str:
    """
    Return a short BunBun line for an event.

    event: "arrived" or "left"
    minutes_present: optional duration before leave (for leave lines)
    """
    event = event.strip().lower()
    if event not in ("arrived", "left"):
        event = "arrived"

    client = _client()
    if client is None:
        return _fallback(event)

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=_build_prompt(event, minutes_present),
        )
        return _clean_line(response.text, event)
    except Exception as exc:
        print(f"[personality] Gemini unavailable ({type(exc).__name__}); using fallback.")
        return _fallback(event)


def line_for_snapshot(
    jpeg_bytes: bytes,
    *,
    reason: str = "timer",
    minutes_present: float | None = None,
) -> str:
    """
    Short comment from one desk JPEG (not every frame).

    reason: "timer" (periodic) or "motion" (moved a lot)
    """
    client = _client()
    if client is None:
        return _fallback("snapshot")

    why = (
        "a scheduled desk check"
        if reason == "timer"
        else "they just moved around a lot"
    )
    present_bit = ""
    if minutes_present is not None and minutes_present > 0:
        present_bit = f" They have been at the desk about {minutes_present:.0f} minutes."

    prompt = (
        f"{PERSONALITY}\n\n"
        f"You are looking at one webcam snapshot because of {why}.{present_bit}\n"
        "React briefly to what you see (posture, desk vibe, clutter, drink, stretch).\n"
        "Do not identify who the person is. Do not judge productivity.\n"
        "Reply with only the spoken line BunBun would say out loud."
    )

    try:
        from google.genai import types

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[
                types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"),
                types.Part.from_text(text=prompt),
            ],
        )
        return _clean_line(response.text, "snapshot")
    except Exception as exc:
        print(f"[personality] Snapshot Gemini failed ({type(exc).__name__}); using fallback.")
        return _fallback("snapshot")


if __name__ == "__main__":
    # Quick manual test: python vision/personality.py
    has_key = bool(os.getenv("GEMINI_API_KEY", "").strip())
    print(f"API key loaded: {has_key}")
    print("arrived →", line_for_event("arrived"))
    print("left    →", line_for_event("left", minutes_present=12))
