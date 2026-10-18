"""
BunBun companion: camera arrive/leave → Gemini line → speak out loud.
Also sparse desk snapshots every N minutes or on big motion.

Run:
  source vision/.venv/bin/activate
  python vision/companion.py

Faster demo snapshots (every 30s):
  python vision/companion.py --snapshot-interval 30
"""

from __future__ import annotations

import argparse
import threading
import time

import cv2
import numpy as np

from detect_faces import run_camera_loop
from motion import MotionTracker
from personality import line_for_event, line_for_snapshot
from voice import speak

# Don't re-greet if they leave and come back within this window
GREET_COOLDOWN_SECONDS = 60.0
# Default: one timed snapshot every 5 minutes while present
SNAPSHOT_INTERVAL_SECONDS = 300.0
# Never send photos more often than this (timer + motion share this gap)
SNAPSHOT_MIN_GAP_SECONDS = 120.0
# Local motion mean-diff threshold (tune if too sensitive / too quiet)
MOTION_THRESHOLD = 8.0

_busy = threading.Lock()
_last_greet_at = 0.0
_last_snapshot_at = 0.0
_present_since: float | None = None

DEFAULT_VOICE = "Junior"


def _encode_jpeg(frame: np.ndarray, quality: int = 70) -> bytes | None:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return buf.tobytes()


def _handle_event(event: str, voice: str, minutes_present: float | None = None) -> None:
    global _last_greet_at, _present_since

    now = time.monotonic()
    if event == "arrived":
        _present_since = now
        if (now - _last_greet_at) < GREET_COOLDOWN_SECONDS:
            remaining = int(GREET_COOLDOWN_SECONDS - (now - _last_greet_at))
            print(f"[companion] Greeting skipped (cooldown {remaining}s left)")
            return
    elif event == "left":
        _present_since = None

    if not _busy.acquire(blocking=False):
        print(f"[companion] Busy speaking; skipped {event}")
        return

    def worker() -> None:
        global _last_greet_at
        try:
            line = line_for_event(event, minutes_present=minutes_present)
            print(f"[companion] {event}: {line}")
            speak(line, voice=voice)
            if event == "arrived":
                _last_greet_at = time.monotonic()
        finally:
            _busy.release()

    threading.Thread(target=worker, daemon=True).start()


def _maybe_snapshot(
    frame: np.ndarray,
    *,
    present: bool,
    minutes_present: float | None,
    voice: str,
    motion: MotionTracker,
    interval: float,
    min_gap: float,
) -> None:
    global _last_snapshot_at, _present_since

    if not present:
        motion.reset()
        return

    now = time.monotonic()
    if _present_since is None:
        _present_since = now

    big_move = motion.is_big_move(frame)
    due_timer = (now - _present_since) >= interval and (now - _last_snapshot_at) >= interval
    # First timer fire: also require min_gap from last snapshot (0 at start → ok after interval)
    gap_ok = (now - _last_snapshot_at) >= min_gap

    reason: str | None = None
    if due_timer and gap_ok:
        reason = "timer"
    elif big_move and gap_ok and _last_snapshot_at > 0:
        # Ignore motion until at least one snapshot window existed / person settled
        reason = "motion"
    elif big_move and gap_ok and (now - _present_since) >= 15:
        # Allow motion shot after 15s present even before first timer
        reason = "motion"

    if reason is None:
        return

    jpeg = _encode_jpeg(frame)
    if jpeg is None:
        print("[companion] JPEG encode failed")
        return

    if not _busy.acquire(blocking=False):
        print(f"[companion] Busy; skipped {reason} snapshot")
        return

    _last_snapshot_at = now  # reserve the slot so we don't queue many

    def worker() -> None:
        try:
            print(f"[companion] Snapshot ({reason}), {len(jpeg)} bytes → Gemini…")
            line = line_for_snapshot(
                jpeg, reason=reason, minutes_present=minutes_present
            )
            print(f"[companion] snapshot: {line}")
            speak(line, voice=voice)
        finally:
            _busy.release()

    threading.Thread(target=worker, daemon=True).start()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BunBun companion (vision + Gemini + voice)")
    parser.add_argument("--camera", type=int, default=0, help="Camera index (0 = built-in)")
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"macOS say voice (default: {DEFAULT_VOICE})",
    )
    parser.add_argument(
        "--snapshot-interval",
        type=float,
        default=SNAPSHOT_INTERVAL_SECONDS,
        help="Seconds between timed desk snapshots while present (default: 300)",
    )
    parser.add_argument(
        "--snapshot-min-gap",
        type=float,
        default=SNAPSHOT_MIN_GAP_SECONDS,
        help="Minimum seconds between any two snapshots (default: 120)",
    )
    parser.add_argument(
        "--motion-threshold",
        type=float,
        default=MOTION_THRESHOLD,
        help="Local motion score needed to trigger a snapshot (default: 10)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    motion = MotionTracker(threshold=args.motion_threshold)

    # For short demo intervals, don't force a longer min-gap than the interval
    min_gap = min(args.snapshot_min_gap, args.snapshot_interval)

    print(
        f"BunBun companion starting (voice={args.voice}). "
        f"Snapshots every {args.snapshot_interval:.0f}s or on big motion "
        f"(min gap {min_gap:.0f}s). Press q in the camera window to quit."
    )

    def on_event(event: str, minutes_present: float | None = None) -> None:
        _handle_event(event, voice=args.voice, minutes_present=minutes_present)

    def on_frame(
        frame: np.ndarray,
        present: bool,
        minutes_present: float | None,
    ) -> None:
        _maybe_snapshot(
            frame,
            present=present,
            minutes_present=minutes_present,
            voice=args.voice,
            motion=motion,
            interval=args.snapshot_interval,
            min_gap=min_gap,
        )

    run_camera_loop(
        camera_index=args.camera,
        on_event=on_event,
        on_frame=on_frame,
    )


if __name__ == "__main__":
    main()
