# Dashboard and robot guide

A study dashboard with personal accounts, robot room rewards, and shared focus races.


The default setup uses local Node accounts. Setting both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the root `.env` selects Supabase email login after restarting Vite or rebuilding. The Node race server loads the same `.env` and verifies cloud identities separately from race membership tokens. Local and Supabase accounts have separate progress; switching modes does not migrate accounts.

## Python robot bridge

1. Follow the setup at the top of `robot.py`, configure the camera IP and serial port, and set `GEMINI_API_KEY` in your shell.
2. Run `python robot.py` on the same laptop as the browser. Its local bridge listens on port 8765. The robot firmware expected by that script is `robot_step3.ino`; that sketch is not included here, so get it from the hardware teammate. The included OLED-only sketch is for the separate USB eyes mode.
3. Start or pause a dashboard session. The dashboard sends timer state to the bridge and displays its feedback. In Supabase mode, bad-habit checks during the active session can subtract points through the Rails API.
4. Use either Python's USB connection or **Connect robot** in the browser. They cannot own the same serial port together. Hardware and firmware still require an end-to-end test on the physical robot.

`python robot_link.py --demo` provides simulated bridge responses for testing. The dashboard's **Timer activity** percentage measures timer ticks, not camera-verified attention. Camera snapshots sent to Gemini are processed by that service. The browser itself does not request webcam access. Hosted HTTPS pages may require browser local-network permission to reach the robot bridge.
## Run

```sh
npm install
npm start
```

In a second terminal:

```sh
npm run dev
```

Vite proxies `/api` to the account and race server on port 4173. Both processes must run: signing in and loading the dashboard require the server. Use Node 22 or newer.

For a built local app, run `npm run build`, then `npm start` and open `http://127.0.0.1:4173`. Use this instead of `npm run preview`, which has no account server. `npm test` checks accounts, access control, progress isolation, personal timers, rewards, race scoring, reconnects, persistence, and the HTTP API.

## Accounts

Create a username and password on the first screen, then log in to use any page. Usernames use 3–24 letters, numbers, or underscores; passwords use 15–128 characters. Each account has separate saved sessions, points, room rewards, and race membership. Open the username menu to log out. Logging out pauses the local timer and disconnects the robot.

The server stores salted scrypt password hashes, never plaintext passwords. Sessions use an HttpOnly, SameSite=Strict cookie, expire after seven days, and are revoked on logout. Restarting the server requires signing in again; accounts and saved progress remain. Login attempts are rate limited. Google sign-in, email verification, and password recovery are not included.

Hash settings follow the [OWASP scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

### Host on Vultr

See [the Vultr deployment guide](../deploy/vultr/README.md) for the Docker setup that runs the app and login API behind HTTPS, with persistent account data and shared friend races. Deployment files are included; a Vultr account, server, and domain still need to be configured. Optional Supabase/Tiger configuration is documented in [the backend guide](../backend/README.md).

### Friends on separate laptops

Run `npm run build`, then `npm run share` on one computer. Everyone, including the host, opens `http://<host-computer-LAN-IP>:4173` on the same reachable network and creates their own account. Create a room and share its six-character code or use **Copy invite**. A localhost invite only works on the host's computer. Network/firewall settings must allow the other devices to reach that port; this command does not change those settings. Stop any existing `npm start` server before using `npm run share`. Plain HTTP is for local demos with throwaway passwords; use HTTPS before collecting real credentials.

For remote friends, deploy this Node server and its `dist` folder together to one shared host with HTTPS and persistent storage for `.data`. Set `NODE_ENV=production` to require Secure cookies, and use `npm run share` behind the HTTPS reverse proxy. Keep the proxy Host header unchanged. This branch does not include an online deployment. `PORT` can override the default port.

## Pages

- **Dashboard:** 15/25/50-minute focus sessions, daily focus time, points, streaks, weekly activity, and recent history. The robot studies while a timer runs and celebrates saved sessions.
- **Focus Quest:** choose a 5/15/25-minute study mission to grow the robot's room. The timer is shared with the dashboard, so switching pages never starts a second session.
- **Friends:** create or join a room for 2–8 players, ready up, then race for 5/15/25 minutes. Live standings show each person's focus time, with a winner or shared win at the end.
- **Stickers:** download three transparent cartoon robot PNGs.

## Points and game progression

Each whole minute in a saved session earns 10 points. Sessions under one minute earn nothing. A fully completed mission earns an additional 25 points (5 minutes), 75 points (15 minutes), or 150 points (25 minutes). Ending a mission early retains whole-minute points but earns no bonus.

Room items unlock automatically at 50, 150, 300, 500, and 1,000 cumulative points. Unlocks do not spend points. The core scoring and timer logic lives in `src/focus.js`.

Tracking is manual self-reported focus time, not AI-verified productivity. Pause during breaks. The personal points are for motivation.

## Race rules

Everyone must be connected and ready before the host starts a shared countdown. The most focused whole seconds within the race window wins; equal scores share the win. A race with zero focus has no winner. Late joins are closed once a race starts, and leaving during a race forfeits the result and unsaved race points.

The server measures elapsed time from heartbeats every two seconds, rather than accepting submitted scores. Paused time and disconnected gaps over 15 seconds earn nothing. A reload restores the room paused; use **Resume focus** to continue. This prevents clients from submitting arbitrary scores, but does not verify attention: someone can still leave their focus timer running. Camera integration can replace the manual focus signal later.

Finishing a race adds 10 personal points per whole focused minute, once per participant, and contributes to room rewards. No extra winner bonus is awarded. Personal sessions and races cannot actively count time together within the same tab.

## Storage

Accounts and completed study sessions are stored in `.data/accounts.json` (ignored by Git). Keep this directory private and back it up on the host. Completed progress syncs to the server and loads when that account signs in on another device. The browser keeps an account-specific cache in `productivity.workspace.account.<account-id>` and retries unsaved sessions if the connection drops. Passwords and session tokens are not stored in local storage.

Active timers checkpoint locally every five seconds and on page exit; after reload they restore paused, with no offline time awarded. Active timers do not move between devices. Abrupt browser termination can lose the last checkpoint interval. Use one active study tab at a time. Old anonymous history in `productivity.workspace.v2` or `productivity.sessions.v1` is preserved but is not automatically assigned to a new account.

Race usernames, readiness, and focus times are shared with the room. Your account username is your race name. Room membership is tied to the account and stored in per-tab session storage, so reloads work but closing the tab can lose access. Keep the tab open through the result to save personal points. The server persists rooms in `.data/races.json` (ignored by Git); rooms expire after 24 hours. Membership tokens and account IDs are never included in shared room snapshots. Existing anonymous rooms must be recreated after this update. This is a small, single-server hackathon service without a global leaderboard.

## Hardware and camera

The team’s six STL files and the original `firmware/robot_eyes/robot_eyes.ino` from `oled-eyes` are included unchanged. The dashboard can now control that firmware's OLED eyes over USB. The optional Python camera and servo prototype runs separately; see the bridge setup below. Direct USB control handles OLED expressions only.

### Connect the OLED eyes

1. Upload `firmware/robot_eyes/robot_eyes.ino` to the ESP32 using the team's Arduino setup. It requires Adafruit GFX and Adafruit SSD1306. The supplied sketch uses a 128×64 OLED at I2C address `0x3C`, SDA 21 and SCL 22; confirm these match your board and wiring.
2. Close Arduino Serial Monitor so the browser can open the USB port. Use a data-capable USB cable.
3. Open the dashboard in desktop Chrome or Edge at localhost (or HTTPS). Click **Connect robot** and select your ESP32's USB serial port. Plain HTTP LAN pages cannot use this USB feature; use localhost on the computer physically connected to the robot or deploy over HTTPS.
4. The status remains **USB open · waiting for eyes** until the firmware replies. **Eyes connected** means the expected firmware acknowledgement arrived, not that a camera or motor connection exists. If it stays waiting, check the uploaded sketch, port, OLED wiring and power. Reloading the page requires reconnecting.
5. Start, pause, resume, or finish a focus session. Friends races use your own focus state; disconnected/paused race tracking selects sleepy eyes. Click **Disconnect robot** when done. The OLED retains its last expression after disconnecting.

| Dashboard state                            | Serial character | Firmware expression |
| ------------------------------------------ | ---------------- | ------------------- |
| Ready                                      | `0`              | IDLE                |
| Studying                                   | `5`              | FOCUSED             |
| Paused                                     | `8`              | SLEEPY              |
| Saved session / completed race with points | `7`              | CELEBRATING         |

The connection uses 115200 baud and the firmware's existing `Emotion changed to: N` acknowledgements. Commands retry once per second until acknowledged to handle board startup. This integration does not infer distraction or change productivity scores. Tests simulate USB streams, acknowledgements, resets, missing displays, and unplugging; physical hardware still needs an end-to-end check.

Browser implementation reference: [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial).

## Artwork

`public/robots/hello.png`, `study.png`, and `celebrate.png` are transparent digital illustrations inspired by the team's physical robot. They were generated with the built-in image generation tool. The README uses a photo of the physical robot with its background removed. Exact generation prompts are recorded in `public/robots/prompts.json`.

The favicon and room decorations are code-native vector/CSS assets. Google Fonts supplies DM Sans and Manrope, with system-font fallbacks.
