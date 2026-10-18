"""
Robot Friend - step 1: the neck follows you.

  ESP32-CAM (Wi-Fi video) -> this program (finds your face) -> ESP32-S over USB -> neck servo

Run:   pip install opencv-python numpy pyserial
       python follow.py
Keys in the window:  q = quit,  f = flip direction (if the head turns AWAY from you),  c = centre the head
"""
import os
import threading
import time

import cv2
import serial

# ======================= settings =======================
CAM_IP = "10.179.24.252"        # the address the ESP32-CAM printed in the Serial Monitor
SERIAL_PORT = "COM9"            # the ESP32-S board's port (Arduino IDE > Tools > Port)
GAIN = 5.0                      # how fast the head turns toward you (bigger = faster, too big = overshoots)
DEADBAND = 0.10                 # don't move if your face is this close to the middle (fraction of the width)
DIRECTION = 1                   # press "f" while running (or set to -1) if the head turns the wrong way
CENTER, NECK_MIN, NECK_MAX = 90, 30, 150
# ========================================================

STREAM_URL = f"http://{CAM_IP}:81/stream"
HERE = os.path.dirname(os.path.abspath(__file__))
YUNET_FILE = os.path.join(HERE, "face_detection_yunet_2023mar.onnx")
YUNET_URL = ("https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
             "face_detection_yunet/face_detection_yunet_2023mar.onnx")


def open_board(port):
    try:
        s = serial.Serial()
        s.port, s.baudrate, s.timeout = port, 115200, 0
        s.dtr = False                  # stops the ESP32 from resetting / going into upload mode
        s.rts = False
        s.open()
        time.sleep(1.5)
        print(f"ESP32 connected on {port}")
        return s
    except serial.SerialException as e:
        print(f"!! can't open {port}: {e}\n   (close the Serial Monitor, check the port number). Running without the servo.")
        return None


class Camera:
    """Keeps only the newest frame, so the servo reacts to what's happening now.
    Uses the video stream on port 81 if it works; otherwise grabs single pictures from
    http://CAM_IP/capture on the normal port (works on networks that block port 81)."""
    def __init__(self, url):
        self.url, self.frame = url, None
        self.snap_url = f"http://{CAM_IP}/capture"
        threading.Thread(target=self._loop, daemon=True).start()

    def _stream(self):
        """Reads the ESP32-CAM's MJPEG stream directly (more reliable than OpenCV's reader)."""
        import urllib.request
        import numpy as np
        try:
            r = urllib.request.urlopen(self.url, timeout=5)
        except Exception as e:
            print(f"!! stream {self.url} not reachable ({e})")
            return False
        print("camera stream open (port 81)")
        buf = b""
        try:
            while True:
                chunk = r.read(4096)
                if not chunk:
                    break
                buf += chunk
                end = buf.rfind(b"\xff\xd9")                 # end of the newest complete picture
                if end < 0:
                    if len(buf) > 2_000_000:
                        buf = b""
                    continue
                start = buf.rfind(b"\xff\xd8", 0, end)       # its start
                if start >= 0:
                    f = cv2.imdecode(np.frombuffer(buf[start:end + 2], np.uint8), cv2.IMREAD_COLOR)
                    if f is not None:
                        self.frame = f
                buf = buf[end + 2:]
        except Exception as e:
            print(f"!! stream stopped ({e})")
        return True

    def _snapshots(self):
        import urllib.request
        import numpy as np
        print(f"using single pictures from {self.snap_url}")
        fails = 0
        while fails < 10:
            try:
                data = urllib.request.urlopen(self.snap_url, timeout=3).read()
                f = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
                if f is not None:
                    self.frame, fails = f, 0
                    continue
            except Exception as e:
                if fails == 0:
                    print(f"!! picture failed: {e}")
            fails += 1
            time.sleep(0.5)

    def _loop(self):
        while True:
            if not self._stream():
                self._snapshots()
                print(f"!! can't reach the camera at {CAM_IP} - is it on, and the laptop on the same Wi-Fi? retrying...")
            time.sleep(1)


def make_detector():
    if not os.path.exists(YUNET_FILE):
        import urllib.request
        print("downloading face model (230 KB)...")
        urllib.request.urlretrieve(YUNET_URL, YUNET_FILE)
    return cv2.FaceDetectorYN.create(YUNET_FILE, "", (320, 240), 0.7, 0.3, 50)


def find_faces(det, frame):
    h, w = frame.shape[:2]
    sw, sh = 320, int(h * 320 / w)
    det.setInputSize((sw, sh))
    _, faces = det.detect(cv2.resize(frame, (sw, sh)))
    k = w / sw
    return [] if faces is None else [tuple(int(v * k) for v in f[:4]) for f in faces]


def main():
    global DIRECTION
    board = open_board(SERIAL_PORT)
    cam = Camera(STREAM_URL)
    det = make_detector()
    angle, sent, last_seen, last_send = float(CENTER), -1, 0.0, 0.0

    def send(a):
        nonlocal sent, last_send
        a = int(round(a))
        if board and a != sent and time.time() - last_send > 0.04:
            board.write(f"N{a}\n".encode())
            sent, last_send = a, time.time()

    send(CENTER)
    while True:
        frame = cam.frame
        if frame is None:
            time.sleep(0.1)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            continue
        frame = frame.copy()
        h, w = frame.shape[:2]
        faces = find_faces(det, frame)
        now = time.time()

        if faces:
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])       # follow the biggest (closest) face
            err = (x + fw / 2) / w - 0.5                               # -0.5 (left) .. +0.5 (right)
            if abs(err) > DEADBAND:
                angle = min(NECK_MAX, max(NECK_MIN, angle - DIRECTION * GAIN * err))
                send(angle)
            last_seen = now
            for (fx, fy, ww, hh) in faces:
                cv2.rectangle(frame, (fx, fy), (fx + ww, fy + hh), (0, 200, 0), 2)
        elif now - last_seen > 3:                                      # nobody for 3 s: drift back to the middle
            angle += (CENTER - angle) * 0.05
            send(angle)

        cv2.line(frame, (w // 2, 0), (w // 2, h), (200, 200, 200), 1)
        txt = f"neck {int(angle)} deg   {'face found' if faces else 'no face'}   direction {DIRECTION:+d}   (q quit, f flip, c centre)"
        cv2.putText(frame, txt, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, txt, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cv2.imshow("Robot Friend - neck follow", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord("f"):
            DIRECTION = -DIRECTION
        if key == ord("c"):
            angle = float(CENTER)
            send(angle)

    send(CENTER)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
