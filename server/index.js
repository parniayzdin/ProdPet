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

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = resolve(root, ".data");
const dataFile = resolve(dataDir, "races.json");
export function createApp({ store } = {}) {
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
        if (parts[1] !== "rooms" || parts.length > 4)
          throw new RaceError("Not found.", 404);
        let data = {};
        if (req.method === "POST") {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 4096) throw new RaceError("Request too large.", 413);
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
        // Bound room creation and code guessing without affecting regular heartbeats.
        if (req.method === "POST" && (!parts[2] || parts[3] === "join")) {
          const now = Date.now();
          const ip = req.socket.remoteAddress;
          for (const [key, record] of limits)
            if (now - record.start > 60000) limits.delete(key);
          const record = limits.get(ip) || { start: now, count: 0 };
          if (++record.count > 30)
            throw new RaceError(
              "Too many attempts. Try again in a minute.",
              429,
            );
          limits.set(ip, record);
        }
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        let result;
        if (!parts[2] && req.method === "POST") result = store.create(data);
        else if (parts[3] === "join" && req.method === "POST")
          result = store.join(parts[2], data);
        else if (parts.length === 3 && req.method === "GET")
          result = store.read(parts[2], token);
        else if (parts.length === 4 && req.method === "POST")
          result = store.action(parts[2], token, parts[3], data);
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
