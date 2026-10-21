import test from "node:test";
import assert from "node:assert/strict";
import { createCloudAuth } from "./cloud-auth.js";
import { createApp } from "./index.js";
import { AccountStore } from "./accounts.js";
import { RaceStore } from "./races.js";

test("Supabase races verify identity independently of room tokens and client IDs", async (t) => {
  const verified = [];
  const cloudAuth = createCloudAuth({
    url: "https://example.supabase.co",
    key: "test-key",
    fetchUser: async (url, options) => {
      assert.equal(url, "https://example.supabase.co/auth/v1/user");
      assert.equal(options.headers.apikey, "test-key");
      const token = options.headers.Authorization;
      verified.push(token);
      if (token === "Bearer expired")
        return new Response("{}", { status: 401 });
      return Response.json({
        id: token.endsWith("alice") ? "a" : "b",
        email: token.endsWith("alice")
          ? "alice@example.test"
          : "bob@example.test",
      });
    },
  });
  const server = createApp({
    accounts: new AccountStore(),
    store: new RaceStore(),
    cloudAuth,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, body, roomToken) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Productivity",
        "X-Supabase-Token": token,
        "X-Account-ID": "spoofed",
        ...(roomToken ? { Authorization: `Bearer ${roomToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const create = await call("/api/rooms", "alice", {
    name: "spoofed",
    minutes: 5,
  });
  assert.equal(create.status, 200);
  const room = await create.json();
  assert.equal(room.room.players[0].name, "alice");
  assert.equal(
    (await call(`/api/rooms/${room.room.code}`, "alice", null, room.token))
      .status,
    200,
  );
  assert.equal(
    (await call(`/api/rooms/${room.room.code}`, "bob", null, room.token))
      .status,
    401,
  );
  const expired = await call("/api/rooms", "expired", { minutes: 5 });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).code, "AUTH_REQUIRED");
  assert.equal(verified.length, 4);
});

test("cloud auth fails closed when missing configuration or auth service is unavailable", async () => {
  await assert.rejects(
    createCloudAuth({ url: "", key: "" })("token"),
    (e) => e.status === 503,
  );
  await assert.rejects(
    createCloudAuth({
      url: "https://example.test",
      key: "x",
      fetchUser: async () => {
        throw Error("offline");
      },
    })("token"),
    (e) => e.status === 503,
  );
});
