import test from "node:test";
import assert from "node:assert/strict";
import { RaceStore } from "./races.js";
import { createApp } from "./index.js";
import { AccountStore } from "./accounts.js";

function fixture() {
  let now = 1000000;
  const store = new RaceStore({ clock: () => now });
  const a = store.create({ name: "Alex", minutes: 5 });
  const b = store.join(a.room.code, { name: "Blair" });
  const code = a.room.code;
  const act = (who, action, data) =>
    store.action(code, who.token, action, data).room;
  const beat = (who, focused = true) => act(who, "heartbeat", { focused });
  const start = () => {
    act(a, "ready", { ready: true });
    act(b, "ready", { ready: true });
    act(a, "start");
    beat(a);
    beat(b);
    now += 3000;
  };
  return {
    store,
    a,
    b,
    code,
    act,
    beat,
    start,
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

test("only host starts and every connected participant must be ready", () => {
  const f = fixture();
  assert.throws(() => f.act(f.b, "start"), /Only the host/);
  assert.throws(() => f.act(f.a, "start"), /must be ready/);
  f.act(f.a, "ready", { ready: true });
  f.act(f.b, "ready", { ready: true });
  f.advance(16000);
  assert.throws(() => f.act(f.a, "start"), /must be ready/);
});

test("fresh server heartbeats credit time; paused player loses; no client totals are trusted", () => {
  const f = fixture();
  f.start();
  for (let i = 0; i < 30; i++) {
    f.advance(10000);
    f.beat(f.a);
    f.beat(f.b, i < 9);
  }
  const result = f.store.read(f.code, f.a.token).room;
  assert.equal(result.status, "finished");
  assert.deepEqual(result.winnerIds, [f.a.room.meId]);
  assert.equal(result.players.find((p) => p.id === f.a.room.meId).seconds, 300);
  assert.equal(result.players.find((p) => p.id === f.b.room.meId).seconds, 100);
  const again = f.act(f.a, "heartbeat", { focused: true, seconds: 999999 });
  assert.equal(again.players[0].seconds, 300);
});

test("ties share the win and nobody wins with zero focus", () => {
  const f = fixture();
  f.start();
  for (let i = 0; i < 30; i++) {
    f.advance(10000);
    f.beat(f.a);
    f.beat(f.b);
  }
  assert.equal(f.store.read(f.code, f.a.token).room.winnerIds.length, 2);
  const g = fixture();
  g.start();
  g.advance(400000);
  assert.deepEqual(g.store.read(g.code, g.a.token).room.winnerIds, []);
});

test("long offline gaps earn no time and reconnect can resume", () => {
  const f = fixture();
  f.start();
  f.advance(10000);
  f.beat(f.a);
  f.advance(30000);
  f.beat(f.a);
  assert.equal(
    f.store
      .read(f.code, f.a.token)
      .room.players.find((p) => p.id === f.a.room.meId).seconds,
    10,
  );
  f.advance(10000);
  f.beat(f.a);
  assert.equal(
    f.store
      .read(f.code, f.a.token)
      .room.players.find((p) => p.id === f.a.room.meId).seconds,
    20,
  );
});

test("late joining, duplicate names, missing credentials, and unknown rooms are rejected", () => {
  const f = fixture();
  assert.throws(() => f.store.join(f.code, { name: "alex" }), /already in/);
  assert.throws(() => f.store.read(f.code, undefined), /no longer valid/);
  assert.throws(() => f.store.read("FFFFFF", "bad"), /not found/);
  f.start();
  assert.throws(
    () => f.store.join(f.code, { name: "Casey" }),
    /already started/,
  );
  assert.throws(() => f.act(f.a, "start"), /already started/);
});

test("leaving lobby transfers hosting; leaving race forfeits eligibility", () => {
  const f = fixture();
  f.act(f.a, "leave");
  assert.equal(f.store.read(f.code, f.b.token).room.hostId, f.b.room.meId);
  const g = fixture();
  g.start();
  g.advance(10000);
  g.act(g.a, "leave");
  for (let i = 0; i < 29; i++) {
    g.advance(10000);
    g.beat(g.b);
  }
  assert.deepEqual(g.store.read(g.code, g.b.token).room.winnerIds, [
    g.b.room.meId,
  ]);
});

test("saved room state restores membership and does not disclose tokens", () => {
  const f = fixture();
  const restored = new RaceStore({
    rooms: JSON.parse(JSON.stringify([...f.store.rooms.values()])),
    clock: f.now,
  });
  const result = restored.read(f.code, f.a.token);
  assert.equal(result.room.players.length, 2);
  assert.equal(JSON.stringify(result).includes(f.a.token), false);
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.throws(() => f.store.read(f.code, f.a.token), /expired/);
});

test("HTTP API supports two clients, validates requests, and rejects wrong origins", async (t) => {
  const server = createApp({
    store: new RaceStore(),
    accounts: new AccountStore(),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookieA;
  const post = (path, data, token, origin, cookie = cookieA) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Productivity",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(data),
    });
  const signupA = await post("/api/auth/signup", {
    username: "alex",
    password: "test-only long passphrase",
  });
  cookieA = signupA.headers.get("set-cookie").split(";")[0];
  const signupB = await post(
    "/api/auth/signup",
    { username: "blair", password: "test-only long passphrase" },
    null,
    null,
    "",
  );
  const cookieB = signupB.headers.get("set-cookie").split(";")[0];
  const created = await (
    await post("/api/rooms", { name: "Alex", minutes: 5 })
  ).json();
  const joined = await (
    await post(
      `/api/rooms/${created.room.code}/join`,
      { name: "Blair" },
      null,
      null,
      cookieB,
    )
  ).json();
  assert.equal(joined.room.players.length, 2);
  const unauthorized = await fetch(`${base}/api/rooms/${created.room.code}`);
  assert.equal(unauthorized.status, 401);
  const wrongOrigin = await post(
    "/api/rooms",
    { name: "Mallory", minutes: 5 },
    null,
    "https://elsewhere.example",
  );
  assert.equal(wrongOrigin.status, 403);
  const nullBody = await post("/api/rooms", null);
  assert.equal(nullBody.status, 400);
  const secret = await fetch(`${base}/.data/races.json`);
  assert.equal(secret.status, 404);
  const room = await (
    await fetch(`${base}/api/rooms/${created.room.code}`, {
      headers: { Authorization: `Bearer ${created.token}`, Cookie: cookieA },
    })
  ).json();
  assert.equal(room.room.meId, created.room.meId);
});
