"""
Milestone 1: Mac webcam face detection (no Gemini, no hardware, no dashboard).

Uses the Mac built-in camera by default (index 0) and OpenCV's YuNet face detector.
Press q in the preview window to quit.

companion.py passes an on_event callback for arrive/leave.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Callable
from pathlib import Path

import cv2

EventCallback = Callable[..., None]

MODEL_PATH = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"
MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)

# A face must be seen for this long before we say "arrived"
ARRIVE_SECONDS = 0.4
# Misses shorter than this don't restart the arrival timer
ARRIVE_GRACE_SECONDS = 0.5
# No face for this long means the person "left"
LEAVE_SECONDS = 4.0

# Lower = finds more faces (turned heads, dim light) but more false boxes
SCORE_THRESHOLD = 0.7

# Detect on a smaller image for speed, then scale boxes back to the full frame
DETECT_WIDTH = 480

# Give up only after this many failed camera reads in a row
MAX_READ_FAILURES = 30


def open_camera(index: int) -> cv2.VideoCapture:
    """Open a camera. Built-in is usually 0; USB is 1."""
    cap = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
    if not cap.isOpened():
        cap = cv2.VideoCapture(index)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    return cap


def load_face_detector() -> cv2.FaceDetectorYN:
    if not MODEL_PATH.exists():
        raise SystemExit(
            f"Face model not found at {MODEL_PATH}\n"
            f'Download it with:\n  curl -L "{MODEL_URL}" -o "{MODEL_PATH}"'
        )
    return cv2.FaceDetectorYN.create(
        str(MODEL_PATH),
        "",
        (320, 320),  # replaced per frame by setInputSize
        SCORE_THRESHOLD,
        0.3,  # overlap threshold for merging duplicate boxes
        50,  # max candidate faces
    )


def detect_faces(
    detector: cv2.FaceDetectorYN, frame: cv2.typing.MatLike
) -> list[tuple[int, int, int, int]]:
    """Return face boxes (x, y, w, h) in full-frame coordinates."""
    height, width = frame.shape[:2]
    scale = DETECT_WIDTH / width if width > DETECT_WIDTH else 1.0
    small = (
        cv2.resize(frame, (DETECT_WIDTH, round(height * scale)), interpolation=cv2.INTER_AREA)
        if scale < 1.0
        else frame
    )

    detector.setInputSize((small.shape[1], small.shape[0]))
    _, raw = detector.detect(small)
    if raw is None:
        return []

    # Each row is [x, y, w, h, 5 landmark points..., score]
    return [
        (int(x / scale), int(y / scale), int(w / scale), int(h / scale))
        for x, y, w, h in raw[:, :4]
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live face detection for BunBun MVP")
    parser.add_argument(
        "--camera",
        type=int,
        default=0,
        help="Camera index (0 = Mac built-in, 1 = often USB Logitech)",
    )
    return parser.parse_args()


def run_camera_loop(
    camera_index: int = 0,
    on_event: EventCallback | None = None,
    on_frame: EventCallback | None = None,
) -> None:
    """
    Open the camera, detect faces, print arrive/leave.

    on_event(event_name, minutes_present=...) is called with:
      - "arrived"
      - "left" (includes minutes_present)

    on_frame(frame, present, minutes_present) is called every good frame
    (frame is a copy safe to keep briefly for snapshots).
    """
    detector = load_face_detector()
    cap = open_camera(camera_index)

    if not cap.isOpened():
        raise SystemExit(
            f"Could not open camera {camera_index}. "
            "Check System Settings → Privacy & Security → Camera, "
            "and try --camera 1 if you meant the USB webcam."
        )

    print(f"Camera {camera_index} open. Looking for faces… (press q in the window to quit)")

    present = False
    face_since: float | None = None
    last_seen: float | None = None
    session_started: float | None = None
    last_faces: list[tuple[int, int, int, int]] = []
    read_failures = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            read_failures += 1
            if read_failures >= MAX_READ_FAILURES:
                print("Camera stopped sending frames. Is it in use by another app?")
                break
            cv2.waitKey(10)
            continue
        read_failures = 0

        faces = detect_faces(detector, frame)
        now = time.monotonic()
        has_face = len(faces) > 0

        if has_face:
            last_faces = faces
            last_seen = now
            if face_since is None:
                face_since = now
        elif face_since is not None and last_seen is not None and now - last_seen > ARRIVE_GRACE_SECONDS:
            face_since = None

        if (
            not present
            and has_face
            and face_since is not None
            and now - face_since >= ARRIVE_SECONDS
        ):
            present = True
            session_started = now
            print(f"[{time.strftime('%H:%M:%S')}] Person arrived")
            if on_event is not None:
                on_event("arrived")

        if present and last_seen is not None and now - last_seen >= LEAVE_SECONDS:
            present = False
            seconds = int(now - session_started) if session_started else 0
            minutes = seconds / 60.0
            print(f"[{time.strftime('%H:%M:%S')}] Person left (was present ~{seconds}s)")
            if on_event is not None:
                on_event("left", minutes_present=minutes)
            session_started = None
            last_faces = []

        minutes_present = (
            (now - session_started) / 60.0 if present and session_started is not None else None
        )
        if on_frame is not None:
            on_frame(frame.copy(), present, minutes_present)

        # If briefly lost but still PRESENT, keep showing the last box in gray
        draw = faces if has_face else (last_faces if present else [])
        color = (0, 200, 80) if has_face else (120, 120, 120)
        for (x, y, w, h) in draw:
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

        status = "PRESENT" if present else "AWAY"
        tracking = "ok" if has_face else ("holding" if present else "none")
        cv2.putText(
            frame,
            f"{status} | track={tracking} | faces={len(faces)} | cam={camera_index}",
            (12, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (40, 40, 40),
            2,
            cv2.LINE_AA,
        )

        cv2.imshow("Desktop buddy", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("Stopped.")


def main() -> None:
    args = parse_args()
    run_camera_loop(camera_index=args.camera)


if __name__ == "__main__":
    main()
