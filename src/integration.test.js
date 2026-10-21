import test from "node:test";
import assert from "node:assert/strict";
import { stableUuid } from "./ids.js";
import { penaltyIdFromCheck, isBadHabitCheck } from "./robotLink.js";
import { cloudEnabled } from "./supabase.js";
import {
  fetchUserSessions,
  postCompletedSession,
  fetchUserStats,
} from "./api.js";

test("race awards use repeatable UUIDs and different users cannot collide", async () => {
  const id = await stableUuid("alice:race-ABC123-player1");
  assert.match(
    id,
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.equal(await stableUuid("alice:race-ABC123-player1"), id);
  assert.notEqual(await stableUuid("bob:race-ABC123-player1"), id);
});

test("robot check IDs survive retries but not bridge restarts", async () => {
  const first = { id: 1, ts: 12345 };
  assert.equal(
    await penaltyIdFromCheck(first),
    await penaltyIdFromCheck(first),
  );
  assert.notEqual(
    await penaltyIdFromCheck(first),
    await penaltyIdFromCheck({ id: 1, ts: 54321 }),
  );
  assert.equal(
    isBadHabitCheck({ status: "bad", reason: "phone", confidence: 0.5 }),
    false,
  );
});

test("no cloud settings uses authenticated local progress rather than crashing at import", async (t) => {
  assert.equal(cloudEnabled, false);
  const requests = [];
  const entry = { id: "study-1", seconds: 60 };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ sessions: [entry] });
  });
  assert.deepEqual(await fetchUserSessions(), [entry]);
  await postCompletedSession(entry);
  assert.equal(requests[0].url, "/api/progress");
  assert.equal(requests[0].credentials, "same-origin");
  assert.equal(requests[1].headers["X-Requested-With"], "Productivity");
  assert.deepEqual(JSON.parse(requests[1].body), { sessions: [entry] });
  assert.equal(await fetchUserStats(), null);
});
