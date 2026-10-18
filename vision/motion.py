"""
Local motion score from consecutive frames.

Used to decide when BunBun should take a snapshot — Gemini never sees every frame.
"""

from __future__ import annotations

import cv2
import numpy as np


class MotionTracker:
    """Mean absolute difference between blurred, downscaled grayscale frames."""

    def __init__(self, threshold: float = 10.0) -> None:
        self.threshold = threshold
        self._prev: np.ndarray | None = None

    def reset(self) -> None:
        self._prev = None

    def score(self, frame: np.ndarray) -> float:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (160, 120), interpolation=cv2.INTER_AREA)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if self._prev is None:
            self._prev = gray
            return 0.0

        diff = cv2.absdiff(self._prev, gray)
        self._prev = gray
        return float(np.mean(diff))

    def is_big_move(self, frame: np.ndarray) -> bool:
        return self.score(frame) >= self.threshold
