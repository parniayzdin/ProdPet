// Talks to teammate's robot.py bridge on :8765 (started automatically by robot.py).
// Use either this bridge or direct USB eye control, not both on the same port.
import { stableUuid } from "./ids.js";

const LINK_URL = (
  import.meta.env?.VITE_ROBOT_LINK_URL || "http://127.0.0.1:8765"
).replace(/\/$/, "");

const BAD_REASONS = new Set([
  "phone",
  "posture",
  "distracted",
  "tired",
  "stressed",
  "long_session",
]);

export async function fetchRobotState() {
  try {
    const res = await fetch(`${LINK_URL}/state`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchRobotChecks(since = 0) {
  try {
    const res = await fetch(`${LINK_URL}/checks?since=${since}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.checks) ? data.checks : [];
  } catch {
    return [];
  }
}

export async function reactRobot(event, extra = {}) {
  try {
    await fetch(`${LINK_URL}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...extra }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* robot.py not running — site still works */
  }
}

/** Stable UUID so the same robot check id never bills twice. */
export function penaltyIdFromCheck(check) {
  return stableUuid(`robot-check:${check.ts}:${check.id}`);
}

export function isBadHabitCheck(check) {
  return (
    check?.status === "bad" &&
    BAD_REASONS.has(check.reason) &&
    (check.confidence == null || Number(check.confidence) >= 0.7)
  );
}
