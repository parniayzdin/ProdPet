"""
Robot link - lets the productivity website talk to robot.py (same laptop).

robot.py starts this automatically. It serves a tiny local API on http://127.0.0.1:8765
(only reachable from this laptop; this bridge returns summaries, not video.
robot.py separately sends snapshots to the Gemini API when configured):

  GET  /state             robot status: connected, face, at desk, sitting time, last Gemini verdict
  GET  /checks?since=ID   Gemini checks newer than ID (status, reason, confidence, tip)
  POST /react             {"event": "face"|"start"|"pause"|"resume"|"finish"|"level", "face": "...", "say": "...", "task": "..."}
                          face: idle | focused | sleepy | celebrating  (what the website's timer is doing)
                          -> robot shows a face / speaks
  POST /summary           {"task", "minutes", "counts", "points", ...} -> {"text": motivation summary}

Try the website without the robot:   python robot_link.py --demo
(makes up a Gemini check every 8 s so you can see everything working)
"""
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = 8765


class RobotLink:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"robot": "starting", "board": False, "camera": False, "face": "idle",
                      "instance_id": str(uuid.uuid4()),
                      "present": False, "sit_seconds": 0, "verdict": None, "session": False, "web_face": None,
                      "updated": time.time()}
        self.checks = []                       # newest last
        self.next_id = 1
        # robot.py fills these in so the website can make the robot react
        self.on_react = lambda event, data: None
        self.summarize = None                  # function(dict) -> str  (Gemini), optional

    # ---- called by robot.py ----
    def update(self, **kw):
        with self.lock:
            self.state.update(kw)
            self.state["updated"] = time.time()

    def add_check(self, verdict):
        with self.lock:
            c = {"id": self.next_id, "ts": time.time(),
                 "status": verdict.get("status"), "reason": verdict.get("reason") or "none",
                 "confidence": verdict.get("confidence"), "what": verdict.get("what_i_see", ""),
                 "tip": verdict.get("tip", ""), "session": self.state.get("session", False)}
            self.next_id += 1
            self.checks.append(c)
            self.checks = self.checks[-500:]
            self.state["verdict"] = c

    # ---- server ----
    def start(self, port=PORT):
        link = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")   # Chrome local-network access
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self._send(204, {})

            def do_GET(self):
                u = urlparse(self.path)
                if u.path == "/state":
                    with link.lock:
                        s = dict(link.state)
                    s["age"] = round(time.time() - s["updated"], 1)
                    self._send(200, s)
                elif u.path == "/checks":
                    since = int((parse_qs(u.query).get("since") or ["0"])[0] or 0)
                    with link.lock:
                        out = [c for c in link.checks if c["id"] > since]
                    self._send(200, {"checks": out})
                else:
                    self._send(404, {"error": "not found"})

            def do_POST(self):
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                    data = json.loads(self.rfile.read(n) or b"{}") if n else {}
                except Exception:
                    return self._send(400, {"error": "bad json"})
                path = urlparse(self.path).path
                if path == "/react":
                    event = str(data.get("event", ""))
                    if event == "face":
                        face = str(data.get("face", "idle"))
                        link.update(web_face=face if face in ("focused", "sleepy") else None,
                                    session=face == "focused")
                    elif event in ("start", "resume"):
                        link.update(session=True)
                    elif event in ("pause", "finish"):
                        link.update(session=False)
                    try:
                        link.on_react(event, data)
                    except Exception as e:
                        print("!! robot reaction failed:", e)
                    self._send(200, {"ok": True})
                elif path == "/summary":
                    text = None
                    if link.summarize:
                        try:
                            text = link.summarize(data)
                        except Exception as e:
                            print("!! summary failed:", e)
                    self._send(200, {"text": text or local_summary(data)})
                else:
                    self._send(404, {"error": "not found"})

        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        except OSError as e:
            print(f"!! website link not started (port {port} busy?): {e}")
            return None
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f"website link on http://127.0.0.1:{port}  (open the productivity dashboard)")
        return srv


def local_summary(d):
    """Simple motivation summary used when Gemini isn't available."""
    c = d.get("counts") or {}
    mins = int(d.get("minutes") or 0)
    score = d.get("focusScore")
    parts = [f"{mins} minute{'s' if mins != 1 else ''} on {d.get('task') or 'your work'}"]
    if score is not None:
        parts.append(f"{score}% verified focus")
    bad = [f"{c[k]} {k}" for k in ("phone", "posture", "distracted") if c.get(k)]
    if bad:
        parts.append("watch out for " + ", ".join(bad))
    elif c.get("good"):
        parts.append("no bad habits spotted, great job")
    if c.get("tired") or c.get("stressed"):
        parts.append("you looked tired, so take a real break")
    return ". ".join(p[0].upper() + p[1:] for p in parts) + "."


def gemini_summary(api_key, model):
    """Returns a function that writes a short motivation summary with Gemini (text only)."""
    def run(d):
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=15000))
        prompt = (
            "You are a cheerful desk-buddy robot. Write a 2-sentence motivation summary (max 40 words) of this "
            "focus session for the person, mention what went well and one concrete thing to improve. "
            "Plain text, no emojis.\n" + json.dumps(d))
        r = client.models.generate_content(model=model, contents=prompt,
                                           config=types.GenerateContentConfig(temperature=0.6))
        return (r.text or "").strip()
    return run


# ---------------- demo mode: no robot needed ----------------
if __name__ == "__main__":
    import random
    import sys
    if "--demo" not in sys.argv:
        print(__doc__)
        sys.exit()
    link = RobotLink()
    link.on_react = lambda e, d: print("website says:", e, d.get("say", ""))
    link.start()
    link.update(robot="demo", board=True, camera=True, present=True)
    tips = {"good": ["Nice focus, keep it up!", "Great posture today!", "You're in the zone!"],
            "phone": ["Put the phone down for now."], "posture": ["Sit up straight, please!"],
            "distracted": ["Back to the task, buddy!"], "tired": ["You look tired, take a short break."]}
    t0 = time.time()
    print("DEMO robot running - a fake Gemini check every 8 s. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(8)
            reason = random.choices(["none", "phone", "posture", "distracted", "tired"], [6, 1.2, 1, 0.6, 0.4])[0]
            status = "good" if reason == "none" else "bad"
            v = {"status": status, "reason": reason, "confidence": round(random.uniform(0.75, 0.98), 2),
                 "what_i_see": "typing at laptop" if status == "good" else f"demo: {reason}",
                 "tip": random.choice(tips["good" if status == "good" else reason])}
            link.add_check(v)
            link.update(face="happy" if status == "good" else "angry", sit_seconds=int(time.time() - t0))
            print("check:", status, reason)
    except KeyboardInterrupt:
        pass
