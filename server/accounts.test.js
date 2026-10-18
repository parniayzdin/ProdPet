import test from "node:test";
import assert from "node:assert/strict";
import { AccountStore, COOKIE_NAME } from "./accounts.js";
import { RaceStore } from "./races.js";
import { createApp } from "./index.js";

const password = "test-only long passphrase";
const entry = {
  id: "study-1",
  task: "Math",
  seconds: 300,
  duration: 300,
  mode: "quest",
  date: "2026-10-17T18:00:00.000Z",
  total: 99999,
};

async function fixture(t, options = {}) {
  const accounts = new AccountStore();
  const server = createApp({ store: new RaceStore(), accounts, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body, cookie = "", headers = {}) {
    return fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Productivity",
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function signup(username) {
    const response = await call("/api/auth/signup", { username, password });
    assert.equal(response.status, 200);
    return {
      cookie: response.headers.get("set-cookie").split(";")[0],
      user: (await response.json()).user,
      header: response.headers.get("set-cookie"),
    };
  }
  return { call, signup, accounts };
}

test("signup hashes credentials, validates input, logs in, rotates and revokes sessions", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("/api/auth/signup", { username: "bad space", password }))
      .status,
    400,
  );
  assert.equal(
    (await f.call("/api/auth/signup", { username: "alex", password: "short" }))
      .status,
    400,
  );
  const a = await f.signup("Alex");
  assert.equal(a.user.username, "alex");
  assert.deepEqual(Object.keys(a.user).sort(), ["id", "username"]);
  const stored = f.accounts.users.get("alex");
  assert.equal(stored.hash.length, 128);
  assert.equal(JSON.stringify(stored).includes(password), false);
  assert.match(a.header, /HttpOnly/);
  assert.match(a.header, /SameSite=Strict/);
  assert.equal(
    (await f.call("/api/auth/signup", { username: "ALEX", password })).status,
    409,
  );
  assert.equal(
    (await f.call("/api/auth/login", { username: "alex", password: "wrong" }))
      .status,
    401,
  );
  const response = await f.call(
    "/api/auth/login",
    { username: "ALEX", password },
    a.cookie,
  );
  assert.equal(response.status, 200);
  const nextCookie = response.headers.get("set-cookie").split(";")[0];
  assert.notEqual(nextCookie, a.cookie);
  assert.equal(
    (await f.call("/api/auth/session", undefined, a.cookie)).status,
    401,
  );
  assert.equal(
    (await f.call("/api/auth/session", undefined, nextCookie)).status,
    200,
  );
  assert.equal((await f.call("/api/auth/logout", {}, nextCookie)).status, 200);
  assert.equal(
    (await f.call("/api/auth/session", undefined, nextCookie)).status,
    401,
  );
});

test("progress and races require login and remain isolated between accounts", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/api/progress")).status, 401);
  assert.equal((await f.call("/api/rooms", { minutes: 5 })).status, 401);
  const a = await f.signup("alice");
  const b = await f.signup("blair");
  const saved = await (
    await f.call(
      "/api/progress",
      { sessions: [entry], userId: b.user.id },
      a.cookie,
    )
  ).json();
  assert.equal(saved.sessions[0].total, 75);
  const second = await (
    await f.call(
      "/api/progress",
      { sessions: [{ ...entry, seconds: 1500 }] },
      a.cookie,
    )
  ).json();
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].total, 75);
  assert.equal(
    (await (await f.call("/api/progress", undefined, b.cookie)).json()).sessions
      .length,
    0,
  );
  const stale = await f.call("/api/progress", { sessions: [entry] }, b.cookie, {
    "X-Account-ID": a.user.id,
  });
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).code, "AUTH_REQUIRED");
  const room = await (
    await f.call("/api/rooms", { minutes: 5, name: "forged" }, a.cookie)
  ).json();
  assert.equal(room.room.players[0].name, "alice");
  const stolen = await f.call(
    `/api/rooms/${room.room.code}`,
    undefined,
    b.cookie,
    { Authorization: `Bearer ${room.token}` },
  );
  assert.equal(stolen.status, 401);
  const own = await f.call(
    `/api/rooms/${room.room.code}`,
    undefined,
    a.cookie,
    { Authorization: `Bearer ${room.token}` },
  );
  assert.equal(own.status, 200);
});

test("cross-site requests, missing custom headers and malformed progress are rejected", async (t) => {
  const f = await fixture(t);
  const a = await f.signup("alex");
  assert.equal(
    (
      await f.call("/api/auth/logout", {}, a.cookie, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/api/auth/logout", {}, a.cookie, { "X-Requested-With": "" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/progress",
        { sessions: [{ ...entry, seconds: -100 }] },
        a.cookie,
      )
    ).status,
    400,
  );
  assert.equal((await f.call("/.data/accounts.json")).status, 404);
  assert.equal(
    (await f.call("/api/auth/session", undefined, a.cookie)).status,
    200,
  );
});

test("accounts survive persistence while expired and restarted login sessions do not", async () => {
  let now = 1000;
  let saved;
  const store = new AccountStore({
    clock: () => now,
    save: (value) => {
      saved = structuredClone(value);
    },
  });
  const user = await store.signup({ username: "alex", password });
  store.appendProgress(user, [entry]);
  const token = store.issue(user);
  const req = { headers: { cookie: `${COOKIE_NAME}=${token}` } };
  assert.equal(store.authenticate(req).id, user.id);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.throws(() => store.authenticate(req), /log in/);
  const restored = new AccountStore({ users: saved });
  assert.equal(
    (await restored.login({ username: "alex", password })).progress[0].total,
    75,
  );
  assert.throws(() => restored.authenticate(req), /log in/);
});

test("production cookies are Secure and repeated login guesses are rate-limited", async (t) => {
  const f = await fixture(t, { secureCookies: true });
  const a = await f.signup("alex");
  assert.match(a.header, /; Secure/);
  for (let i = 0; i < 9; i++)
    await f.call("/api/auth/login", { username: "alex", password: "wrong" });
  assert.equal(
    (await f.call("/api/auth/login", { username: "alex", password: "wrong" }))
      .status,
    429,
  );
});
