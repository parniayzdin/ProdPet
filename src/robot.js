// Matches firmware/robot_eyes/robot_eyes.ino, unchanged from oled-eyes.
export const EMOTIONS = { idle: 0, focused: 5, celebrating: 7, paused: 8 };

export function studyEmotion({
  running,
  active,
  celebrating,
  raceActive,
  raceFocused,
}) {
  if (running) return "focused";
  if (active) return "paused";
  if (raceActive) return raceFocused ? "focused" : "paused";
  return celebrating ? "celebrating" : "idle";
}

export class RobotEyes {
  constructor({
    serial,
    onStatus = () => {},
    schedule = setInterval,
    unschedule = clearInterval,
  }) {
    this.serial = serial;
    this.onStatus = onStatus;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.emotion = "idle";
    this.port = null;
    this.busy = false;
    this.confirmed = null;
  }
  setEmotion(emotion) {
    if (!(emotion in EMOTIONS)) throw new Error("Unsupported eye emotion");
    if (this.emotion === emotion) return;
    this.emotion = emotion;
    this.confirmed = null;
    if (this.port) this.onStatus("waiting", "Sending eye expression…");
    void this.send();
  }
  async connect() {
    if (this.busy || this.port) return;
    if (!this.serial)
      throw new Error(
        "Open this dashboard in Chrome or Edge on localhost or HTTPS to connect USB.",
      );
    this.busy = true;
    let selected;
    try {
      selected = await this.serial.requestPort();
      await selected.open({ baudRate: 115200 });
      this.port = selected;
      this.confirmed = null;
      this.onStatus("waiting", "USB open · waiting for eyes");
      this.readTask = this.read(selected);
      // Boards may restart when USB opens. Retry only until firmware confirms.
      this.interval = this.schedule(() => {
        void this.send();
      }, 1000);
      await this.send();
    } catch (error) {
      if (this.port) await this.disconnect();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async send() {
    const port = this.port;
    if (!port?.writable || this.writing || this.confirmed === this.emotion)
      return;
    this.writing = (async () => {
      let writer;
      try {
        writer = port.writable.getWriter();
        await writer.write(
          new TextEncoder().encode(String(EMOTIONS[this.emotion])),
        );
      } catch {
        this.onStatus("error", "USB write failed · reconnect robot");
      } finally {
        writer?.releaseLock();
      }
    })();
    await this.writing;
    this.writing = null;
  }
  async read(port) {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      this.reader = port.readable.getReader();
      while (this.port === port) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop().slice(-256);
        for (const raw of lines) {
          const line = raw.trim();
          if (line === "OLED not found") {
            this.onStatus("error", "OLED not found · check display wiring");
          } else if (line === "Robot eyes ready!") {
            this.confirmed = null;
            void this.send();
          } else if (line === `Emotion changed to: ${EMOTIONS[this.emotion]}`) {
            this.confirmed = this.emotion;
            this.onStatus("connected", `Eyes connected · ${this.emotion}`);
          }
        }
      }
    } catch {
      // Unplugging rejects a pending serial read.
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
      if (this.port === port) {
        this.onStatus("error", "Robot disconnected · reconnect USB");
        // Let this read task resolve before disconnect awaits it.
        queueMicrotask(() => {
          void this.disconnect(false);
        });
      }
    }
  }
  async disconnect(report = true) {
    const port = this.port;
    if (!port) return;
    this.port = null;
    this.unschedule(this.interval);
    try {
      await this.reader?.cancel();
    } catch {
      /* Already unplugged. */
    }
    await this.readTask;
    await this.writing;
    try {
      await port.close();
    } catch {
      /* Already unplugged. */
    }
    this.confirmed = null;
    this.onStatus(
      report ? "offline" : "error",
      report ? "Robot offline" : "Robot disconnected · reconnect USB",
    );
  }
}

export function initRobot(notify) {
  const button = document.querySelector("#robot-connect");
  const status = document.querySelector("#robot-status");
  const robot = new RobotEyes({
    serial: navigator.serial,
    onStatus(state, message) {
      status.textContent = message;
      status.dataset.state = state;
      button.textContent = robot.port ? "Disconnect robot" : "Connect robot";
    },
  });
  if (!navigator.serial || !window.isSecureContext) {
    button.disabled = true;
    status.textContent = "USB needs Chrome/Edge on localhost or HTTPS";
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (robot.port) await robot.disconnect();
      else await robot.connect();
    } catch (error) {
      if (error.name !== "NotFoundError")
        notify(
          "Could not connect. Close Arduino Serial Monitor, check USB, and try again.",
        );
    } finally {
      button.disabled = false;
      button.textContent = robot.port ? "Disconnect robot" : "Connect robot";
    }
  });
  return robot;
}
