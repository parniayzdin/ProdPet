"""
Robot Friend - step 2: neck follows you, and the mouth "complains" when you slip into bad desk habits.

  ESP32-CAM (Wi-Fi) -> this program -> ESP32-S (USB) -> neck servo (GPIO14) + mouth servo (GPIO13)
                           |
                           +-> Gemini: every GEMINI_EVERY (20) seconds a snapshot is checked for
                               phone use, bad posture, distraction, or signs of tiredness / burnout

  bad  -> mouth flaps for ANGRY_SECONDS after each bad check
  good -> mouth stays shut

Setup (once):
    pip install opencv-python numpy pyserial google-genai   (Mac/Linux voice: also pyttsx3)
    Get a key at aistudio.google.com -> "Get API key", then in cmd:
        setx GEMINI_API_KEY "your-key"
    and open a NEW terminal.
Run:
    python robot.py
OLED faces: idle while you work, curious when you sit down, searching when it loses you, sleepy when
nobody's around, thinking while asking Gemini, happy after a good check, angry after a bad one,
celebrating when you fix a bad habit.  (Firmware: robot_step3.ino)
Keys in the window:  q quit,  g check now,  f flip neck direction,  c centre neck,  m test mouth,
                     0-9 preview a face
"""
import json
import queue
import os
import threading
import time

import cv2

import follow                      # camera, face finder and board connection from step 1
import robot_link                  # lets the productivity website talk to the robot

# ======================= settings =======================
CAM_IP = "10.50.124.252"           # the ESP32-CAM's address
SERIAL_PORT = "COM9"               # the ESP32-S port
GEMINI_MODEL = "gemini-3.5-flash-lite"   # if you get "model not found", pick one from ai.google.dev/gemini-api/docs/models
GEMINI_EVERY = 20                  # seconds between checks
MIN_CONFIDENCE = 0.7               # ignore "bad" answers Gemini isn't sure about (raise to be stricter)
SPEAK = True                       # read Gemini's tip out loud on the laptop speakers
SPEAK_GOOD_EVERY = 3               # when you're doing fine, only speak every 3rd good check (bad = always)
MOUTH_WHEN_HAPPY = False           # True = mouth also moves while it says happy tips
VOICE_RATE = 175                   # speaking speed (words per minute)
ANGRY_SECONDS = 3                  # how long the mouth flaps after each "bad" check
GAIN, DEADBAND = 5.0, 0.10         # neck tuning (same as follow.py)

# ---- OLED faces (numbers match your friend's eye code) ----
FACES = {"idle": 0, "searching": 1, "happy": 2, "curious": 3, "thinking": 4,
         "focused": 5, "distracted": 6, "celebrating": 7, "sleepy": 8, "angry": 9}
BAD_FACE = {"phone": "angry", "posture": "angry", "distracted": "angry",       # which face for each bad habit
            "tired": "angry", "stressed": "angry", "long_session": "angry"}    # (e.g. try "sleepy" for tired)
ANGRY_FACE_SECONDS = 10            # how long the angry face stays after a bad check
HAPPY_FACE_SECONDS = 5             # how long the happy face stays after a good check
DIRECTION = 1
CENTER, NECK_MIN, NECK_MAX = 90, 30, 150
# ========================================================

API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gemini_key.txt")
if not API_KEY and os.path.exists(_KEY_FILE):            # or: paste the key alone into gemini_key.txt next to this file
    API_KEY = open(_KEY_FILE, encoding="utf-8").read().strip()

PROMPT = """You are a friendly desk-buddy robot looking at ONE photo of a person at their desk, taken by a small,
low-quality webcam. They have been at the desk for about {mins} minutes.

Judge ONLY what you can clearly see in THIS photo. Count as BAD only if one of these is clearly visible:
- phone: holding a phone, or looking down at a phone
- posture: obviously slouched or hunched, head very close to the screen, head propped on a hand
- distracted: clearly not working (turned away, playing, napping)
- tired: a CLEAR action - yawning, eyes fully closed, rubbing eyes, head resting on the desk or in hands
- stressed: a CLEAR action - head in hands, hands pulling at hair, face buried in hands
- long_session: they have been at the desk over 90 minutes (only if nothing else is bad)
NOT bad: a neutral or serious face, looking at the screen, normal blinking, dark or grainy image, glasses,
resting chin briefly, being slightly off-centre. A plain "looks a bit tired" face is NOT enough.
If unsure, answer good. Do not diagnose anything medical.

Reply with JSON only:
{{"status": "good" or "bad",
  "reason": "phone" or "posture" or "distracted" or "tired" or "stressed" or "long_session" or "none",
  "confidence": a number 0-1 for how clearly the reason is visible,
  "what_i_see": "max 10 words",
  "tip": "one short friendly tip, max 12 words"}}"""


def ask_gemini(frame, mins, history):
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=15000))   # give up after 15 s
    small = cv2.resize(frame, (640, int(frame.shape[0] * 640 / frame.shape[1])))
    jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()
    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[types.Part.from_bytes(data=jpg, mime_type="image/jpeg"),
                  PROMPT.format(mins=mins)],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
    )
    v = json.loads(resp.text)
    if isinstance(v, list):
        v = v[0]
    return v


# ---------------- voice (laptop speakers) ----------------
speech_q = queue.Queue()

def _clean(text):
    """Plain ASCII only - emojis / curly quotes can break the speech command."""
    for a, b in (("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"'), ("\u2014", ", "), ("\u2013", ", ")):
        text = text.replace(a, b)
    return " ".join(text.encode("ascii", "ignore").decode().split())

def _speak_windows(text):
    """Windows' built-in voice (System.Speech) through PowerShell - no extra install needed."""
    import subprocess
    safe = _clean(text).replace("'", "''").replace('"', "")
    rate = max(-10, min(10, round((VOICE_RATE - 175) / 15)))
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = {rate}; $s.Speak('{safe}')")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=60,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200] or "PowerShell speech failed")

def _speak_pyttsx3(text):
    import pyttsx3
    engine = pyttsx3.init()
    engine.setProperty("rate", VOICE_RATE)
    engine.say(text)
    engine.runAndWait()
    engine.stop()

def speaker_loop(on_start):
    speak = _speak_windows if os.name == "nt" else _speak_pyttsx3
    while True:
        text, mad = speech_q.get()
        print("SAYING:", text)
        try:
            on_start(text, mad)                        # mouth (never blocks the voice)
        except Exception as e:
            print("!! mouth command failed:", e)
        try:
            speak(text)
        except Exception as e:
            print("!! voice failed:", e)
            if speak is _speak_windows:               # fall back to pyttsx3 if PowerShell speech fails
                try:
                    _speak_pyttsx3(text)
                except Exception as e2:
                    print("!! pyttsx3 also failed:", e2)

def say(text, mad=False):
    text = str(text or "").strip()
    if SPEAK and text:
        while not speech_q.empty():                    # drop old lines - only say the newest
            try:
                speech_q.get_nowait()
            except queue.Empty:
                break
        speech_q.put((text, mad))


def main():
    global DIRECTION
    if not API_KEY:
        print('!! No Gemini key found. Either paste it into gemini_key.txt next to robot.py,')
        print('   or in cmd:  setx GEMINI_API_KEY "your-key"   and then open a NEW terminal.')
    else:
        print(f"Gemini key found ({API_KEY[:4]}...{API_KEY[-3:]})")
    follow.CAM_IP = CAM_IP
    board = follow.open_board(SERIAL_PORT)
    lock = threading.Lock()

    def tx(cmd):
        if board:
            try:
                with lock:
                    board.write((cmd + "\n").encode())
            except Exception as e:                     # a board hiccup must never stop the rest
                print(f"!! couldn't send {cmd} to the ESP32: {e}")

    def talking(text, mad):                            # mouth moves while it speaks - only when mad
        if mad or MOUTH_WHEN_HAPPY:
            tx(f"T{int(len(text.split()) * 60000 / VOICE_RATE) + 400}")
    threading.Thread(target=speaker_loop, args=(talking,), daemon=True).start()
    good_count = 0

    cam = follow.Camera(f"http://{CAM_IP}:81/stream")
    det = follow.make_detector()

    angle, sent, last_send = float(CENTER), -1, 0.0
    last_seen, sit_start = 0.0, None
    last_check = 0.0
    busy = threading.Event()
    verdict = {"status": "good", "reason": "none", "what_i_see": "waiting for first check", "tip": ""}
    history = []
    hold_face, hold_until, was_bad = "idle", 0.0, False
    appeared_at, face_sent = 0.0, None

    def set_face(name):
        nonlocal face_sent
        if name != face_sent:
            tx(f"E{FACES[name]}")
            face_sent = name

    def show_for(name, seconds):
        nonlocal hold_face, hold_until
        hold_face, hold_until = name, time.time() + seconds

    # ---- link to the productivity website (http://127.0.0.1:8765) ----
    link = robot_link.RobotLink()
    if API_KEY:
        link.summarize = robot_link.gemini_summary(API_KEY, GEMINI_MODEL)

    def on_react(event, data):
        task = str(data.get("task") or "your work")[:60]
        if event == "start":
            show_for("focused", 4)
            say(data.get("say") or f"Let's focus on {task}. You've got this!")
        elif event == "resume":
            show_for("focused", 3)
        elif event == "pause":
            say(data.get("say") or "Paused. Take the time you need.")
        elif event in ("finish", "level"):
            show_for("celebrating", 6)
            say(data.get("say") or "Session done. Nice work!")
        elif event == "face" and data.get("face") == "celebrating":
            show_for("celebrating", 6)
    link.on_react = on_react
    link.start()
    link.update(robot="running", board=board is not None)

    def send_neck(a):
        nonlocal sent, last_send
        a = int(round(a))
        if a != sent and time.time() - last_send > 0.04:
            tx(f"N{a}")
            sent, last_send = a, time.time()

    def check(frame, mins):
        nonlocal verdict, was_bad, good_count
        print("asking Gemini...")
        try:
            v = ask_gemini(frame, mins, history)
            try:
                conf = float(v.get("confidence", 1))
            except (TypeError, ValueError):
                conf = 1.0
            if v.get("status") == "bad" and conf < MIN_CONFIDENCE:     # not sure -> treat as fine
                v["status"], v["what_i_see"] = "good", f"(unsure {conf:.1f}) " + str(v.get("what_i_see", ""))
            verdict = v
            bad = v.get("status") == "bad"
            link.add_check(v)                                # -> website (points, habit summary)
            history.append(f"{v.get('status')} ({v.get('reason')})")
            print(f"GEMINI: {'BAD ' if bad else 'good'} | {v.get('reason')} ({conf:.1f}) | {v.get('what_i_see')} | tip: {v.get('tip')}")
            tx(f"T{int(ANGRY_SECONDS * 1000)}" if bad else "H")   # bad -> one short burst of flapping
            if bad:
                show_for(BAD_FACE.get(v.get("reason"), "angry"), ANGRY_FACE_SECONDS)
            elif was_bad:
                show_for("celebrating", 4)                        # you fixed it!
            else:
                show_for("happy", HAPPY_FACE_SECONDS)
            if bad or was_bad:                           # speak every bad check, and when you fix it
                default = {"phone": "Hey! Put the phone down.", "posture": "Sit up straight, please!",
                           "tired": "You look tired. Take a short break.", "distracted": "Back to work, buddy!",
                           "stressed": "Take a deep breath.", "long_session": "Time for a break!"}
                say(v.get("tip") or (default.get(v.get("reason"), "Hey!") if bad else "Nice, much better!"), mad=bad)
            else:
                good_count += 1
                if good_count % SPEAK_GOOD_EVERY == 1 or SPEAK_GOOD_EVERY <= 1:
                    say(v.get("tip"))
            was_bad = bad
        except Exception as e:
            print("!! Gemini check failed:", e)
        finally:
            busy.clear()

    tx("H")
    send_neck(CENTER)
    while True:
        frame = cam.frame
        if frame is None:
            if cv2.waitKey(100) & 0xFF == ord("q"):
                break
            continue
        frame = frame.copy()
        h, w = frame.shape[:2]
        faces = follow.find_faces(det, frame)
        now = time.time()

        # ---- neck follows the closest face ----
        if faces and now - last_seen > 10:              # someone (re)appeared after a while
            appeared_at = now
        if faces:
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            err = (x + fw / 2) / w - 0.5
            if abs(err) > DEADBAND:
                angle = min(NECK_MAX, max(NECK_MIN, angle - DIRECTION * GAIN * err))
                send_neck(angle)
            last_seen = now
            if sit_start is None:
                sit_start = now
            for (fx, fy, ww, hh) in faces:
                cv2.rectangle(frame, (fx, fy), (fx + ww, fy + hh), (0, 200, 0), 2)
        elif now - last_seen > 3:
            angle += (CENTER - angle) * 0.05
            send_neck(angle)
        if sit_start and now - last_seen > 60:          # gone for a minute: that was a break
            sit_start = None
            tx("H")

        # ---- Gemini check (only while someone has been seen in the last 30 s; looking down at a
        #      phone can hide the face for a while, so it keeps checking) ----
        mins = int((now - sit_start) // 60) if sit_start else 0
        if busy.is_set() and now - last_check > 30:      # a check that never came back: give up on it
            print("!! Gemini didn't answer in 30 s - skipping that check")
            busy.clear()
        if API_KEY and now - last_seen < 30 and not busy.is_set() and now - last_check > GEMINI_EVERY:
            last_check = now
            busy.set()
            threading.Thread(target=check, args=(frame.copy(), mins), daemon=True).start()

        # ---- OLED face: what the robot is feeling right now ----
        if now < hold_until:
            face = hold_face                             # reacting to the last Gemini check
        elif busy.is_set() and now - last_check < 8:
            face = "thinking"                            # asking Gemini (max 8 s of thinking face)
        elif now - last_seen > 60:
            face = "sleepy"                              # nobody around for a minute
        elif now - last_seen > 3:
            face = "searching"                           # lost you - looking around
        elif now - appeared_at < 2.5:
            face = "curious"                             # oh, someone's here!
        elif link.state.get("web_face"):
            face = link.state["web_face"]                # website timer: focused, or sleepy when paused
        else:
            face = "idle"                                # watching you work, blinking
        set_face(face)
        link.update(face=face, present=now - last_seen < 3, camera=True,
                    sit_seconds=int(now - sit_start) if sit_start else 0)

        # ---- overlay ----
        bad = verdict.get("status") == "bad"
        col = (0, 0, 230) if bad else (0, 170, 0)
        lines = [f"{'BAD: ' + str(verdict.get('reason')) if bad else 'GOOD'}  -  {verdict.get('what_i_see', '')}",
                 f"tip: {verdict.get('tip', '')}",
                 f"face {face}   at desk {mins} min   neck {int(angle)}   next check {max(0, int(GEMINI_EVERY - (now - last_check)))} s"
                 + ("  (asking Gemini...)" if busy.is_set() else ""),
                 "q quit  g check  s say tip  f flip  c centre  m mouth  0-9 faces"]
        for i, t in enumerate(lines):
            cv2.putText(frame, t, (10, 22 + 22 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(frame, t, (10, 22 + 22 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col if i == 0 else (255, 255, 255), 1)
        if bad:
            cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (0, 0, 230), 6)
        cv2.imshow("Robot Friend", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("g"):
            last_check = 0
            last_seen = max(last_seen, now)
        elif key == ord("f"):
            DIRECTION = -DIRECTION
        elif key == ord("c"):
            angle = float(CENTER)
            send_neck(angle)
        elif key == ord("s"):
            say(verdict.get("tip"), mad=verdict.get("status") == "bad")   # say the last tip again
        elif key == ord("m"):
            tx("T2000")                                 # flap the mouth for 2 s
        elif ord("0") <= key <= ord("9"):               # preview a face for 3 s
            show_for([n for n, i in FACES.items() if i == key - ord("0")][0], 3)

    tx("H")
    tx("E8")                                            # sleepy face when the program closes
    send_neck(CENTER)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
