import http from "node:http";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RaceStore, RaceError } from "./races.js";
import { AccountStore, publicAccount, sessionCookie } from "./accounts.js";
import { createCloudAuth } from "./cloud-auth.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = resolve(root, ".data");
const dataFile = resolve(dataDir, "races.json");
export function createApp({
  store,
  accounts,
  cloudAuth = createCloudAuth(),
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  if (!accounts) {
    mkdirSync(dataDir, { recursive: true });
    const accountFile = resolve(dataDir, "accounts.json");
    const users = existsSync(accountFile)
      ? JSON.parse(readFileSync(accountFile, "utf8"))
      : [];
    if (!Array.isArray(users))
      throw new Error(
        "Invalid account data. Restore .data/accounts.json before starting.",
      );
    accounts = new AccountStore({
      users,
      save(value) {
        writeFileSync(`${accountFile}.tmp`, JSON.stringify(value), {
          mode: 0o600,
        });
        renameSync(`${accountFile}.tmp`, accountFile);
      },
    });
  }
  if (!store) {
    mkdirSync(dataDir, { recursive: true });
    let rooms = [];
    if (existsSync(dataFile)) {
      const parsed = JSON.parse(readFileSync(dataFile, "utf8"));
      if (!Array.isArray(parsed))
        throw new Error(
          "Invalid saved race data. Restore .data/races.json before starting.",
        );
      rooms = parsed;
    }
    store = new RaceStore({
      rooms,
      save: (value) => {
        writeFileSync(`${dataFile}.tmp`, JSON.stringify(value));
        renameSync(`${dataFile}.tmp`, dataFile);
      },
    });
  }
  const dist = resolve(root, "dist");
  const limits = new Map();
  function rateLimit(key, maximum, windowMs) {
    const now = Date.now();
    for (const [id, record] of limits)
      if (record.until <= now) limits.delete(id);
    const record = limits.get(key) || { until: now + windowMs, count: 0 };
    record.count++;
    limits.set(key, record);
    if (record.count > maximum)
      throw new RaceError("Too many attempts. Please try again later.", 429);
  }
  const send = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/health") return send(res, 200, { ok: true });
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST"].includes(req.method))
          throw new RaceError("Method not allowed.", 405);
        if (
          req.method === "POST" &&
          (req.headers["x-requested-with"] !== "Productivity" ||
            !req.headers["content-type"]?.startsWith("application/json"))
        )
          throw new RaceError("Invalid request headers.", 403);
        if (req.method === "POST" && req.headers.origin) {
          const origin = new URL(req.headers.origin);
          const development =
            ["localhost", "127.0.0.1"].includes(origin.hostname) &&
            ["5173", "5174"].includes(origin.port) &&
            ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
              req.socket.remoteAddress,
            );
          if (origin.host !== req.headers.host && !development)
            throw new RaceError("Origin not allowed.", 403);
        }
        const parts = url.pathname.split("/").filter(Boolean);
        let data = {};
        if (req.method === "POST") {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > (url.pathname === "/api/progress" ? 131072 : 4096))
              throw new RaceError("Request too large.", 413);
            chunks.push(chunk);
          }
          try {
            data = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            throw new RaceError("Invalid JSON.");
          }
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw new RaceError("Invalid request.");
        }
        if (
          req.method === "POST" &&
          ["/api/auth/signup", "/api/auth/login"].includes(url.pathname)
        ) {
          rateLimit(`auth-ip:${req.socket.remoteAddress}`, 30, 10 * 60000);
          rateLimit(
            `auth-user:${String(data.username).trim().toLowerCase().slice(0, 128)}`,
            10,
            10 * 60000,
          );
          const user = url.pathname.endsWith("signup")
            ? await accounts.signup(data)
            : await accounts.login(data);
          const token = accounts.issue(user, accounts.token(req));
          res.setHeader("Set-Cookie", sessionCookie(token, secureCookies));
          return send(res, 200, { user: publicAccount(user) });
        }
        const cloudToken = req.headers["x-supabase-token"];
        const user =
          cloudToken && parts[1] === "rooms"
            ? await cloudAuth(cloudToken)
            : accounts.authenticate(req);
        if (url.pathname === "/api/auth/session" && req.method === "GET")
          return send(res, 200, { user: publicAccount(user) });
        if (url.pathname === "/api/auth/logout" && req.method === "POST") {
          accounts.revoke(accounts.token(req));
          res.setHeader("Set-Cookie", sessionCookie("", secureCookies));
          return send(res, 200, { ok: true });
        }
        if (url.pathname === "/api/progress") {
          if (req.method === "POST") {
            rateLimit(`progress:${user.id}`, 120, 60000);
            return send(res, 200, {
              sessions: accounts.appendProgress(user, data.sessions),
            });
          }
          return send(res, 200, { sessions: user.progress || [] });
        }
        if (parts[1] !== "rooms" || parts.length > 4)
          throw new RaceError("Not found.", 404);
        // Bound room creation and code guessing without affecting regular heartbeats.
        if (req.method === "POST" && (!parts[2] || parts[3] === "join")) {
          rateLimit(`rooms:${user.id}`, 30, 60000);
        }
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        let result;
        if (!parts[2] && req.method === "POST")
          result = store.create({
            ...data,
            name: user.username,
            accountId: user.id,
          });
        else if (parts[3] === "join" && req.method === "POST")
          result = store.join(parts[2], {
            name: user.username,
            accountId: user.id,
          });
        else if (parts.length === 3 && req.method === "GET")
          result = store.read(parts[2], token, user.id);
        else if (parts.length === 4 && req.method === "POST")
          result = store.action(parts[2], token, parts[3], data, user.id);
        else throw new RaceError("Not found.", 404);
        return send(res, 200, result);
      }
      if (!["GET", "HEAD"].includes(req.method))
        return send(res, 405, { error: "Method not allowed." });
      const path = resolve(
        dist,
        `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
      );
      if (
        !path.startsWith(`${dist}${sep}`) ||
        !existsSync(path) ||
        !statSync(path).isFile()
      )
        return send(res, 404, {
          error: "Page not found. Run npm run build first.",
        });
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".json": "application/json",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(path).pipe(res);
    } catch (error) {
      if (!(error instanceof RaceError))
        console.error("Request failed:", error.message);
      if (!res.headersSent)
        send(res, error.status || 500, {
          code: error.authRequired ? "AUTH_REQUIRED" : undefined,
          error:
            error instanceof RaceError
              ? error.message
              : "Server error. Please try again.",
        });
      else res.end();
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.argv.includes("--share") ? "0.0.0.0" : "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const app = createApp();
  app.listen(port, host, () =>
    console.log(
      `Productivity + race server: http://${host === "0.0.0.0" ? "<your-computer-IP>" : host}:${port}`,
    ),
  );
}
