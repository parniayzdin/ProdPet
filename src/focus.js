export const MISSIONS = {
  5: { title: "Quick win", bonus: 25 },
  15: { title: "Find your flow", bonus: 75 },
  25: { title: "Deep dive", bonus: 150 },
};

export const UNLOCKS = [
  { id: "plant", title: "Desk plant", points: 50, symbol: "❧" },
  { id: "books", title: "Book collection", points: 150, symbol: "▤" },
  { id: "lamp", title: "Warm light", points: 300, symbol: "☼" },
  { id: "art", title: "A little art", points: 500, symbol: "◈" },
  { id: "stars", title: "Starry ceiling", points: 1000, symbol: "✦" },
];

export function score(seconds, mode = "focus", duration = 1500) {
  const base = Math.floor(Math.max(0, seconds) / 60) * 10;
  const bonus =
    mode === "quest" && seconds >= duration
      ? (MISSIONS[duration / 60]?.bonus ?? 0)
      : 0;
  return { base, bonus, total: base + bonus };
}

export function normalizeSessions(raw) {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter(
    (s) =>
      s &&
      typeof s.task === "string" &&
      Number.isFinite(s.seconds) &&
      s.seconds >= 60 &&
      s.seconds <= 3000 &&
      typeof s.date === "string" &&
      Number.isFinite(Date.parse(s.date)),
  );
  return Array.from(
    new Map(
      valid.map((s) => {
        const mode = s.mode === "quest" ? "quest" : "focus";
        const duration = [300, 900, 1500, 3000].includes(s.duration)
          ? s.duration
          : 3000;
        const id =
          typeof s.id === "string"
            ? s.id
            : `legacy-${s.date}-${s.seconds}-${s.task}`;
        const seconds = Math.min(Math.floor(s.seconds), duration);
        return [
          id,
          {
            id,
            task: s.task.slice(0, 120),
            date: s.date,
            seconds,
            duration,
            mode,
            ...score(seconds, mode, duration),
          },
        ];
      }),
    ).values(),
  ).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// An injected monotonic clock makes pausing and reward boundaries deterministic.
export class FocusSession {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.active = null;
    this.startedAt = null;
  }
  get running() {
    return this.startedAt !== null;
  }
  elapsed() {
    if (!this.active) return 0;
    return Math.min(
      this.active.duration,
      this.active.elapsed +
        (this.running ? Math.max(0, this.clock() - this.startedAt) / 1000 : 0),
    );
  }
  start({ id, task, minutes, mode = "focus" }) {
    if (this.active) return false;
    if (mode === "quest" ? !MISSIONS[minutes] : ![15, 25, 50].includes(minutes))
      return false;
    this.active = {
      id,
      task: task.trim().slice(0, 120) || "Focused work",
      duration: minutes * 60,
      mode,
      elapsed: 0,
    };
    this.startedAt = this.clock();
    return true;
  }
  pause() {
    if (!this.active || !this.running) return;
    this.active.elapsed = this.elapsed();
    this.startedAt = null;
  }
  resume() {
    if (this.active && !this.running) this.startedAt = this.clock();
  }
  snapshot() {
    return this.active ? { ...this.active, elapsed: this.elapsed() } : null;
  }
  restore(saved) {
    if (
      !saved ||
      typeof saved.id !== "string" ||
      typeof saved.task !== "string" ||
      !Number.isFinite(saved.elapsed) ||
      saved.elapsed < 0 ||
      ![300, 900, 1500, 3000].includes(saved.duration)
    )
      return false;
    if (
      saved.mode === "quest"
        ? !MISSIONS[saved.duration / 60]
        : ![900, 1500, 3000].includes(saved.duration)
    )
      return false;
    this.active = {
      ...saved,
      task: saved.task.slice(0, 120),
      mode: saved.mode === "quest" ? "quest" : "focus",
      elapsed: Math.min(saved.duration, saved.elapsed),
    };
    this.startedAt = null; // Never count time while the page was closed.
    return true;
  }
  finish(date = new Date().toISOString()) {
    if (!this.active) return null;
    const seconds = Math.floor(this.elapsed());
    const result = {
      ...this.active,
      seconds,
      date,
      ...score(seconds, this.active.mode, this.active.duration),
    };
    this.active = null;
    this.startedAt = null;
    delete result.elapsed;
    return seconds >= 60 ? result : null;
  }
}

export const dayKey = (date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export function streakFor(sessions, now = new Date()) {
  const days = new Set(sessions.map((s) => dayKey(new Date(s.date))));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
