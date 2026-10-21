import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { RaceError } from "./races.js";
import { normalizeSessions } from "../src/focus.js";

const derive = promisify(scrypt);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = "productivity_session";
export const publicAccount = (user) => ({
  id: user.id,
  username: user.username,
});

export class AccountStore {
  constructor({ users = [], save = () => {}, clock = Date.now } = {}) {
    this.users = new Map(users.map((user) => [user.username, user]));
    this.sessions = new Map();
    this.save = save;
    this.clock = clock;
    this.hashing = 0;
  }
  flush() {
    this.save([...this.users.values()]);
  }
  username(value) {
    const username =
      typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username))
      throw new RaceError(
        "Use 3–24 letters, numbers, or underscores for your username.",
      );
    return username;
  }
  async passwordHash(password, salt) {
    if (this.hashing >= 4)
      throw new RaceError("Please try again in a moment.", 429);
    this.hashing++;
    try {
      return await derive(password, salt, 64, {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024,
      });
    } finally {
      this.hashing--;
    }
  }
  async signup({ username: value, password }) {
    const username = this.username(value);
    if (
      typeof password !== "string" ||
      password.length < 15 ||
      password.length > 128
    )
      throw new RaceError(
        "Choose a password with 15–128 characters. A short phrase works well.",
      );
    if (this.users.has(username))
      throw new RaceError("That username is taken.", 409);
    if (this.users.size >= 1000)
      throw new RaceError("Account capacity reached. Contact the host.", 503);
    const salt = randomBytes(16).toString("hex");
    const hash = (await this.passwordHash(password, salt)).toString("hex");
    if (this.users.has(username))
      throw new RaceError("That username is taken.", 409);
    const user = { id: randomUUID(), username, salt, hash, progress: [] };
    this.users.set(username, user);
    try {
      this.flush();
    } catch (e) {
      this.users.delete(username);
      throw e;
    }
    return user;
  }
  async login({ username: value, password }) {
    const invalid = () => new RaceError("Incorrect username or password.", 401);
    if (
      typeof value !== "string" ||
      typeof password !== "string" ||
      password.length > 128 ||
      value.length > 128
    )
      throw invalid();
    const user = this.users.get(value.trim().toLowerCase());
    // Unknown users also run scrypt so username discovery is not a cheap timing check.
    const actual = await this.passwordHash(
      password,
      user?.salt || "00000000000000000000000000000000",
    );
    const expected = Buffer.from(user?.hash || "00".repeat(64), "hex");
    if (!timingSafeEqual(actual, expected) || !user) throw invalid();
    return user;
  }
  token(req) {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    return raw?.slice(COOKIE_NAME.length + 1) || "";
  }
  issue(user, oldToken = "") {
    this.revoke(oldToken);
    for (const [key, session] of this.sessions)
      if (session.expires <= this.clock()) this.sessions.delete(key);
    // Keep a bounded number of sessions per account.
    const existing = [...this.sessions].filter(
      ([, session]) => session.userId === user.id,
    );
    for (const [key] of existing.slice(0, Math.max(0, existing.length - 9)))
      this.sessions.delete(key);
    const token = randomBytes(32).toString("hex");
    this.sessions.set(hashToken(token), {
      userId: user.id,
      username: user.username,
      expires: this.clock() + SESSION_AGE,
    });
    return token;
  }
  revoke(token) {
    if (token) this.sessions.delete(hashToken(token));
  }
  authenticate(req) {
    const token = this.token(req);
    const session = token && this.sessions.get(hashToken(token));
    if (!session || session.expires <= this.clock()) {
      this.revoke(token);
      throw Object.assign(new RaceError("Please log in to continue.", 401), {
        authRequired: true,
      });
    }
    const user = this.users.get(session.username);
    if (
      !user ||
      user.id !== session.userId ||
      (req.headers["x-account-id"] && req.headers["x-account-id"] !== user.id)
    )
      throw Object.assign(
        new RaceError("Your account changed. Please log in again.", 401),
        { authRequired: true },
      );
    return user;
  }
  appendProgress(user, entries) {
    if (!Array.isArray(entries) || entries.length > 100)
      throw new RaceError("Send up to 100 study sessions at a time.");
    if (
      entries.some((s) => !s || typeof s.id !== "string" || s.id.length > 150)
    )
      throw new RaceError("Invalid study session.");
    const normalized = normalizeSessions(entries);
    if (normalized.length !== entries.length)
      throw new RaceError("Invalid study session.");
    const previous = user.progress || [];
    // Existing IDs are immutable. Retries do not change rewards or double count.
    const known = new Set(previous.map((s) => s.id));
    const added = normalized.filter((s) => !known.has(s.id));
    if (previous.length + added.length > 5000)
      throw new RaceError("Study history is full. Contact the host.", 409);
    user.progress = normalizeSessions([...previous, ...added]);
    try {
      if (added.length) this.flush();
    } catch (e) {
      user.progress = previous;
      throw e;
    }
    return user.progress;
  }
}

export function sessionCookie(token, secure = false) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? SESSION_AGE / 1000 : 0}${secure ? "; Secure" : ""}`;
}
