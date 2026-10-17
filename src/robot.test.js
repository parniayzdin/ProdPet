import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RobotEyes, EMOTIONS, studyEmotion } from "./robot.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let incoming;
  let retry;
  let stopped = false;
  const writes = [];
  const states = [];
  const port = {
    readable: new ReadableStream({
      start(controller) {
        incoming = controller;
      },
    }),
    writable: new WritableStream({
      write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
      },
    }),
    async open(options) {
      assert.equal(options.baudRate, 115200);
    },
    async close() {
      assert.equal(this.readable.locked, false);
      assert.equal(this.writable.locked, false);
      this.closed = true;
    },
  };
  const robot = new RobotEyes({
    serial: {
      async requestPort() {
        return port;
      },
    },
    onStatus: (...state) => states.push(state),
    schedule: (fn) => {
      retry = fn;
      return 1;
    },
    unschedule: () => {
      stopped = true;
    },
  });
  return {
    robot,
    port,
    writes,
    states,
    push: (text) => incoming.enqueue(new TextEncoder().encode(text)),
    unplug: () => incoming.error(new Error("Unplugged")),
    retry: () => retry(),
    stopped: () => stopped,
  };
}

test("personal and friend sessions map to firmware emotions without claiming distraction", () => {
  assert.equal(studyEmotion({}), "idle");
  assert.equal(studyEmotion({ running: true }), "focused");
  assert.equal(studyEmotion({ active: true }), "paused");
  assert.equal(studyEmotion({ celebrating: true }), "celebrating");
  assert.equal(
    studyEmotion({ raceActive: true, raceFocused: true }),
    "focused",
  );
  assert.equal(
    studyEmotion({ raceActive: true, raceFocused: false }),
    "paused",
  );
  const firmware = readFileSync(
    new URL("../firmware/robot_eyes/robot_eyes.ino", import.meta.url),
    "utf8",
  );
  for (const [state, number] of Object.entries(EMOTIONS)) {
    const label = state === "paused" ? "SLEEPY" : state.toUpperCase();
    assert.match(firmware, new RegExp(`${label},?\\s*// ${number}`));
  }
  assert.match(firmware, /Serial.begin\(115200\)/);
});

test("USB sends exact digits, waits for acknowledgements, handles fragmented input and board reset", async () => {
  const f = fixture();
  f.robot.setEmotion("focused");
  await f.robot.connect();
  assert.deepEqual(f.writes, ["5"]);
  assert.equal(f.states.at(-1)[0], "waiting");
  f.push("Emotion changed to: ");
  f.push("5\r\n");
  await tick();
  assert.equal(f.states.at(-1)[0], "connected");
  f.retry();
  await tick();
  assert.equal(f.writes.length, 1);
  f.push("Robot eyes ready!\r\n");
  await tick();
  assert.deepEqual(f.writes, ["5", "5"]);
  f.robot.setEmotion("paused");
  await tick();
  assert.equal(f.writes.at(-1), "8");
  f.push("Emotion changed to: 5\n");
  await tick();
  assert.equal(f.robot.confirmed, null);
  f.push("Emotion changed to: 8\n");
  await tick();
  assert.equal(f.robot.confirmed, "paused");
  f.robot.setEmotion("celebrating");
  await tick();
  assert.equal(f.writes.at(-1), "7");
  await f.robot.disconnect();
  assert.ok(f.port.closed);
  assert.ok(f.stopped());
  assert.equal(f.robot.port, null);
});

test("display failure and unplugging never report a working robot", async () => {
  const f = fixture();
  await f.robot.connect();
  f.push("OLED not found\n");
  await tick();
  assert.equal(f.states.at(-1)[0], "error");
  f.unplug();
  await tick();
  await tick();
  assert.equal(f.robot.port, null);
  assert.ok(f.port.closed);
  assert.ok(f.stopped());
  assert.equal(f.states.at(-1)[0], "error");
});

test("cancelled chooser leaves no connection and unsupported browsers fail clearly", async () => {
  const robot = new RobotEyes({
    serial: {
      requestPort: async () => {
        throw new DOMException("Cancelled", "NotFoundError");
      },
    },
  });
  await assert.rejects(robot.connect(), { name: "NotFoundError" });
  assert.equal(robot.port, null);
  assert.equal(robot.busy, false);
  await assert.rejects(new RobotEyes({}).connect(), /Chrome or Edge/);
  assert.throws(() => robot.setEmotion("LEFT"), /Unsupported/);
});
