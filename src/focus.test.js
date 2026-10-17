import test from "node:test";
import assert from "node:assert/strict";
import {
  FocusSession,
  normalizeSessions,
  score,
  streakFor,
  UNLOCKS,
} from "./focus.js";

function fixture() {
  let now = 0;
  const timer = new FocusSession(() => now);
  return {
    timer,
    advance: (seconds) => {
      now += seconds * 1000;
    },
  };
}

test("pauses exclude break time and finishing cannot award twice", () => {
  const { timer, advance } = fixture();
  timer.start({ id: "one", task: "Study", minutes: 15 });
  advance(60);
  timer.pause();
  advance(600);
  timer.resume();
  advance(60);
  const result = timer.finish();
  assert.equal(result.seconds, 120);
  assert.equal(result.total, 20);
  assert.equal(timer.finish(), null);
});

test("sub-minute sessions earn nothing", () => {
  const { timer, advance } = fixture();
  timer.start({ id: "one", task: "Study", minutes: 25 });
  advance(59.9);
  assert.equal(timer.finish(), null);
});

test("mission bonus is only awarded at the complete duration", () => {
  assert.deepEqual(score(299, "quest", 300), { base: 40, bonus: 0, total: 40 });
  assert.deepEqual(score(300, "quest", 300), {
    base: 50,
    bonus: 25,
    total: 75,
  });
  assert.equal(score(900, "quest", 900).total, 225);
  assert.equal(score(1500, "quest", 1500).total, 400);
  assert.equal(score(1500, "focus", 1500).bonus, 0);
});

test("elapsed time is capped even when completion polling is delayed", () => {
  const { timer, advance } = fixture();
  timer.start({ id: "one", task: "Study", minutes: 5, mode: "quest" });
  advance(10000);
  const result = timer.finish();
  assert.equal(result.seconds, 300);
  assert.equal(result.total, 75);
  assert.equal(UNLOCKS.filter((item) => result.total >= item.points).length, 1);
});

test("restoring a mission counts no offline time and retains its identity", () => {
  const { timer, advance } = fixture();
  timer.start({ id: "one", task: "Study", minutes: 5, mode: "quest" });
  advance(120);
  const restored = new FocusSession(() => 9000000);
  assert.equal(
    restored.restore(JSON.parse(JSON.stringify(timer.snapshot()))),
    true,
  );
  assert.equal(restored.running, false);
  assert.equal(restored.elapsed(), 120);
  assert.equal(restored.finish().id, "one");
});

test("old history migrates and ignores untrusted points or malformed entries", () => {
  const old = {
    task: "Old task",
    seconds: 125,
    date: "2026-10-16T12:00:00Z",
    points: 99999,
  };
  const result = normalizeSessions([
    old,
    old,
    null,
    { task: "Invalid", seconds: -1, date: "bad" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].total, 20);
  assert.equal(result[0].mode, "focus");
});

test("quest history retains earned bonuses but does not accept fabricated bonuses", () => {
  const result = normalizeSessions([
    {
      id: "one",
      task: "Study",
      seconds: 300,
      duration: 300,
      mode: "quest",
      bonus: 9999,
      date: "2026-10-17T12:00:00Z",
    },
  ]);
  assert.equal(result[0].bonus, 25);
  assert.equal(result[0].total, 75);
});

test("active session cannot be replaced and invalid snapshots are rejected", () => {
  const { timer } = fixture();
  assert.equal(timer.start({ id: "bad", task: "", minutes: 999 }), false);
  assert.equal(
    timer.restore({
      id: "bad",
      task: "",
      duration: 300,
      elapsed: -1,
      mode: "quest",
    }),
    false,
  );
  timer.start({ id: "one", task: "First task", minutes: 25 });
  assert.equal(
    timer.start({ id: "two", task: "Second task", minutes: 5, mode: "quest" }),
    false,
  );
  assert.equal(timer.active.id, "one");
});

test("streak handles today, yesterday, and gaps using local dates", () => {
  const now = new Date(2026, 9, 17, 15);
  const row = (day) => ({ date: new Date(2026, 9, day, 12).toISOString() });
  assert.equal(streakFor([row(16), row(15)], now), 2);
  assert.equal(streakFor([row(17), row(16), row(15)], now), 3);
  assert.equal(streakFor([row(14)], now), 0);
});
