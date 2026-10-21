import { cloudEnabled, getAccessToken, getUserId } from "./supabase.js";

const API_URL = (
  import.meta.env?.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function localProgress(sessions) {
  const res = await fetch("/api/progress", {
    method: sessions ? "POST" : "GET",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Productivity",
    },
    body: sessions ? JSON.stringify({ sessions }) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || "Could not sync progress.");
    error.status = res.status;
    throw error;
  }
  return data;
}

async function authHeaders() {
  const token = await getAccessToken();
  if (!token) {
    const error = new Error("Not signed in");
    error.status = 401;
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function postCompletedSession(session) {
  if (!cloudEnabled) return localProgress([session]);
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: session.id,
      task: session.task,
      date: session.date,
      seconds: session.seconds,
      duration: session.duration,
      mode: session.mode || "focus",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchUserSessions() {
  if (!cloudEnabled) return (await localProgress()).sessions;
  const headers = await authHeaders();
  const userId = await getUserId();
  const res = await fetch(`${API_URL}/users/${userId}/sessions`, { headers });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchUserStats() {
  if (!cloudEnabled) return null;
  const headers = await authHeaders();
  const userId = await getUserId();
  const res = await fetch(`${API_URL}/users/${userId}/stats`, { headers });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function postPresence({
  sessionId,
  present = true,
  source = "timer",
}) {
  if (!cloudEnabled) return null;
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}/presence`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId || null,
      present,
      source,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchFocusQuality(sessionId) {
  if (!cloudEnabled) return null;
  const headers = await authHeaders();
  const userId = await getUserId();
  const qs = sessionId ? `?session_id=${sessionId}` : "";
  const res = await fetch(`${API_URL}/users/${userId}/focus-quality${qs}`, {
    headers,
  });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function postHabitPenalty({
  id,
  reason,
  confidence = 1,
  tip = "",
  sessionId = null,
}) {
  if (!cloudEnabled) return null;
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}/penalties`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id,
      reason,
      confidence,
      tip,
      session_id: sessionId,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(detail || `API ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
