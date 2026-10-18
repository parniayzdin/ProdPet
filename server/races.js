import { randomBytes, randomUUID } from "node:crypto";

export class RaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status) => {
  throw new RaceError(message, status);
};
const LEASE = 15000;
const TTL = 24 * 60 * 60 * 1000;

export class RaceStore {
  constructor({ clock = Date.now, rooms = [], save = () => {} } = {}) {
    this.clock = clock;
    this.rooms = new Map(rooms.map((room) => [room.code, room]));
    this.save = save;
  }
  flush() {
    this.save([...this.rooms.values()]);
  }
  clean() {
    for (const [code, room] of this.rooms)
      if (this.clock() - room.createdAt > TTL) this.rooms.delete(code);
  }
  name(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 24 || /[\u0000-\u001f]/.test(name))
      fail("Enter a name between 1 and 24 characters.");
    return name;
  }
  player(name, accountId = null) {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString("hex"),
      name: this.name(name),
      accountId,
      ready: false,
      focused: false,
      focusMs: 0,
      lastBeat: this.clock(),
      left: false,
    };
  }
  get(code) {
    this.clean();
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room) fail("Room not found or expired. Check the code.", 404);
    this.finalize(room);
    return room;
  }
  authenticate(room, token, accountId) {
    const player = room.players.find(
      (p) =>
        p.token === token &&
        !p.left &&
        (accountId === undefined || p.accountId === accountId),
    );
    if (!player) fail("This room session is no longer valid. Join again.", 401);
    return player;
  }
  settle(room, player, now) {
    // Credit only elapsed server time covered by fresh, consecutive heartbeats.
    if (
      room.status === "running" &&
      player.focused &&
      now - player.lastBeat <= LEASE
    ) {
      player.focusMs += Math.max(
        0,
        Math.min(now, room.endsAt) - Math.max(player.lastBeat, room.startsAt),
      );
      player.focusMs = Math.min(room.minutes * 60000, player.focusMs);
    }
    player.lastBeat = now;
  }
  finalize(room) {
    if (room.status !== "running" || this.clock() < room.endsAt) return;
    for (const p of room.players) {
      this.settle(room, p, this.clock());
      p.focused = false;
    }
    room.status = "finished";
    const eligible = room.players.filter((p) => !p.left);
    const highest = Math.max(
      0,
      ...eligible.map((p) => Math.floor(p.focusMs / 1000)),
    );
    room.winnerIds =
      highest > 0
        ? eligible
            .filter((p) => Math.floor(p.focusMs / 1000) === highest)
            .map((p) => p.id)
        : [];
    this.flush();
  }
  snapshot(room, member) {
    const now = this.clock();
    return {
      code: room.code,
      hostId: room.hostId,
      minutes: room.minutes,
      status: room.status,
      startsAt: room.startsAt,
      endsAt: room.endsAt,
      winnerIds: room.winnerIds || [],
      serverNow: now,
      meId: member.id,
      players: room.players
        .map((p) => ({
          id: p.id,
          name: p.name,
          ready: p.ready,
          left: p.left,
          focused: p.focused && now - p.lastBeat <= LEASE,
          online: now - p.lastBeat <= LEASE,
          seconds: Math.floor(p.focusMs / 1000),
        }))
        .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name)),
    };
  }
  create({ name, minutes, accountId }) {
    this.clean();
    if (![5, 15, 25].includes(minutes))
      fail("Choose a 5, 15, or 25 minute race.");
    if (this.rooms.size >= 500)
      fail("The server is full. Try again later.", 503);
    const host = this.player(name, accountId);
    let code;
    do {
      code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    } while (this.rooms.has(code));
    const room = {
      code,
      hostId: host.id,
      minutes,
      status: "lobby",
      createdAt: this.clock(),
      startsAt: null,
      endsAt: null,
      players: [host],
    };
    this.rooms.set(code, room);
    this.flush();
    return { room: this.snapshot(room, host), token: host.token };
  }
  join(code, { name, accountId }) {
    const room = this.get(code);
    if (room.status !== "lobby")
      fail("This race has already started. Join the next race.", 409);
    if (room.players.length >= 8) fail("This room is full (8 players).", 409);
    const player = this.player(name, accountId);
    if (
      room.players.some(
        (p) => p.name.toLowerCase() === player.name.toLowerCase(),
      )
    )
      fail("That name is already in the room. Choose another.");
    room.players.push(player);
    this.flush();
    return { room: this.snapshot(room, player), token: player.token };
  }
  read(code, token, accountId) {
    const room = this.get(code);
    return {
      room: this.snapshot(room, this.authenticate(room, token, accountId)),
    };
  }
  action(code, token, action, data = {}, accountId) {
    const room = this.get(code);
    const player = this.authenticate(room, token, accountId);
    const now = this.clock();
    if (action === "heartbeat") {
      this.settle(room, player, now);
      player.focused = room.status === "running" && data.focused === true;
    } else if (action === "ready") {
      if (room.status !== "lobby") fail("The race has already started.", 409);
      player.ready = data.ready === true;
      player.lastBeat = now;
    } else if (action === "start") {
      if (player.id !== room.hostId)
        fail("Only the host can start the race.", 403);
      if (room.status !== "lobby") fail("The race has already started.", 409);
      if (
        room.players.length < 2 ||
        room.players.some((p) => !p.ready || now - p.lastBeat > LEASE)
      )
        fail("At least two connected players must be ready.", 409);
      room.status = "running";
      room.startsAt = now + 3000;
      room.endsAt = room.startsAt + room.minutes * 60000;
      for (const p of room.players) {
        p.lastBeat = now;
        p.focused = false;
      }
    } else if (action === "leave") {
      this.settle(room, player, now);
      player.focused = false;
      if (room.status === "lobby") {
        room.players = room.players.filter((p) => p.id !== player.id);
        if (!room.players.length) this.rooms.delete(room.code);
        else if (room.hostId === player.id) room.hostId = room.players[0].id;
      } else player.left = true;
      this.flush();
      return { left: true };
    } else fail("Unknown room action.", 404);
    this.flush();
    return { room: this.snapshot(room, player) };
  }
}
